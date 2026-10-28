import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { scoreHeadlines } from "./agent";
import * as alpaca from "./alpaca";
import { db, newsScores, sentimentSnapshots, sentimentTrades, type SentimentDriver } from "./db";
import { round } from "./indicators";
import { pickOption } from "./options";
import type { Settings } from "./settings";
import { vwapSeries } from "./strategies/session";
import { etDay, etMinutes, hhmmToMinutes } from "./time";

// News sentiment reader, shadow mode: every market-hours tick it scores new headlines with Claude, folds them into
// one decaying market score, and opens/closes hypothetical SPY option trades on it. It never places an order.

// Index ETFs and the largest S&P 500 weights; Benzinga stories tagged with one of these (or with no ticker, which
// is where macro and politics land) are scored. Everything else in the feed is single-company noise.
const MARKET_SYMBOLS = new Set([
  "SPY", "QQQ", "DIA", "IWM", "VOO", "IVV",
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "GOOG", "META", "AVGO", "TSLA", "BRK.B", "JPM", "LLY",
]);
const LOOKBACK_MIN = 6 * 60; // headlines older than this no longer count
const FETCH_LOOKBACK_MIN = 4 * 60; // first tick of the day reaches back this far (pre-market news)
const MAX_SCORE_PER_TICK = 120;
const BATCH = 30;
const SCALE = 1.5; // score = tanh(sum / SCALE): one strong, confident headline is about 0.4
const KIND_WEIGHT: Record<string, number> = { new_information: 1, opinion: 0.3 }; // recap, repeat, noise: 0

type Scored = typeof newsScores.$inferSelect;

function contribution(n: Scored, now: number, halfLifeMin: number) {
  const ageMin = Math.max(0, (now - n.publishedAt.getTime()) / 60_000);
  return n.impact * n.confidence * n.relevance * (KIND_WEIGHT[n.kind] ?? 0) * 0.5 ** (ageMin / halfLifeMin);
}

export function aggregate(rows: Scored[], now: number, halfLifeMin: number) {
  const parts = rows.map((n) => ({ n, c: contribution(n, now, halfLifeMin) })).filter((x) => Math.abs(x.c) > 1e-4);
  const sum = parts.reduce((s, x) => s + x.c, 0);
  const drivers: SentimentDriver[] = parts
    .sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 5)
    .map((x) => ({ id: x.n.id, headline: x.n.headline, contribution: round(x.c, 3) }));
  return { score: round(Math.tanh(sum / SCALE), 3), headlines: parts.length, drivers };
}

async function ingest(settings: Settings, log: string[]) {
  const latest = await db.select({ t: newsScores.publishedAt }).from(newsScores).orderBy(desc(newsScores.publishedAt)).limit(1);
  const floor = Date.now() - FETCH_LOOKBACK_MIN * 60_000;
  // A couple of minutes of overlap catches stories that reach the feed late; ids dedupe them.
  const since = new Date(Math.max(floor, (latest[0]?.t.getTime() ?? 0) - 2 * 60_000));
  const feed = (await alpaca.getMarketNews(since)).filter(
    (n) => n.source === "benzinga" && (!n.symbols.length || n.symbols.some((s) => MARKET_SYMBOLS.has(s))),
  );
  if (!feed.length) return;
  const seen = new Set(
    (await db.select({ id: newsScores.id }).from(newsScores).where(inArray(newsScores.id, feed.map((n) => n.id)))).map((r) => r.id),
  );
  const fresh = feed.filter((n) => !seen.has(n.id)).slice(0, MAX_SCORE_PER_TICK);
  if (!fresh.length) return;

  const recent = (await db.select({ headline: newsScores.headline }).from(newsScores)
    .where(and(gte(newsScores.publishedAt, new Date(Date.now() - LOOKBACK_MIN * 60_000)), gte(newsScores.relevance, 0.3)))
    .orderBy(desc(newsScores.publishedAt)).limit(20)).map((r) => r.headline);

  // Batches run in parallel so a pre-market backlog fits inside one tick (~10s per 25 headlines on Haiku).
  const batches = Array.from({ length: Math.ceil(fresh.length / BATCH) }, (_, i) => fresh.slice(i * BATCH, (i + 1) * BATCH));
  const results = await Promise.all(batches.map((batch) => scoreHeadlines({
    model: settings.sentiment.model, recent,
    items: batch.map((n) => ({ id: n.id, publishedAt: n.created_at, headline: n.headline, summary: n.summary, symbols: n.symbols })),
  })));
  const byId = new Map(results.flatMap((r) => r.scores.map((x) => [x.id, x] as const)));
  const tokens = results.reduce((t, r) => t + r.inputTokens + r.outputTokens, 0);
  // Headlines Claude skipped are stored as unscored (zero weight) so they aren't fetched and scored again.
  await db.insert(newsScores).values(fresh.map((n) => {
    const x = byId.get(n.id);
    return {
      id: n.id, publishedAt: new Date(n.created_at), headline: n.headline, summary: n.summary || null,
      symbols: n.symbols, url: n.url ?? null, model: settings.sentiment.model,
      impact: x?.impact ?? 0, confidence: x?.confidence ?? 0, relevance: x?.relevance ?? 0,
      kind: x?.kind ?? "unscored", category: x?.category ?? "other", reason: x?.reason ?? null,
    };
  })).onConflictDoNothing();
  log.push(`sentiment: scored ${fresh.length} headlines (${tokens} tokens)`);
}

// 05:00 UTC is midnight EST / 1am EDT; the reader only acts in market hours, so either is a clean day boundary.
const dayStart = (day: string) => new Date(`${day}T05:00:00Z`);
const entryPriceFor = (bid: number, ask: number) => Math.min(Math.ceil(((bid + ask) / 2) * 100) / 100, ask);

/** One sentiment tick. Errors are the caller's to log; nothing here touches the broker beyond market data. */
export async function sentimentTick(settings: Settings, log: string[]) {
  const cfg = settings.sentiment;
  if (!cfg.enabled) return;
  const clock = await alpaca.getClock();
  if (!clock.is_open) return;

  await ingest(settings, log);

  const now = Date.now();
  const rows = await db.select().from(newsScores).where(gte(newsScores.publishedAt, new Date(now - LOOKBACK_MIN * 60_000)));
  const { score, headlines, drivers } = aggregate(rows, now, cfg.halfLifeMin);

  const bars = (await alpaca.getSessionBars(["SPY"], 5)).SPY ?? [];
  const spy = (await alpaca.getDailyBars(["SPY"])).SPY?.at(-1)?.c ?? bars.at(-1)?.c;
  const vwap = bars.length ? vwapSeries(bars).at(-1)! : undefined;
  if (!spy) throw new Error("sentiment: no SPY price");

  const minute = etMinutes();
  const today = etDay();
  const [open] = await db.select().from(sentimentTrades).where(eq(sentimentTrades.status, "open"));
  let note: string;

  if (open) {
    const bullish = open.direction === "bullish";
    const bid = open.contract ? (await alpaca.getOptionSnapshots([open.contract]))[open.contract]?.latestQuote?.bp : undefined;
    const o = settings.options;
    const reason =
      minute >= hhmmToMinutes(cfg.closeByET) ? "end_of_day"
      : (bullish ? score < cfg.exitThreshold : score > -cfg.exitThreshold) ? "sentiment_faded"
      : bid && open.entryPrice && bid <= open.entryPrice * (1 - o.premiumStopPct / 100) ? "premium_stop"
      : bid && open.entryPrice && bid >= open.entryPrice * (1 + o.premiumTargetPct / 100) ? "premium_target"
      : null;
    if (reason) {
      const exitPrice = bid ?? null;
      const pnl = exitPrice != null && open.entryPrice && open.qty ? round((exitPrice - open.entryPrice) * 100 * open.qty) : null;
      await db.update(sentimentTrades).set({
        status: "closed", closedAt: new Date(), exitReason: reason, exitScore: score, exitSpy: spy, exitPrice,
        pnl, pnlPct: exitPrice != null && open.entryPrice ? round((exitPrice / open.entryPrice - 1) * 100) : null,
        spyMovePct: round((spy / open.entrySpy - 1) * 100 * (bullish ? 1 : -1), 3),
      }).where(eq(sentimentTrades.id, open.id));
      note = `closed ${open.direction} (${reason.replaceAll("_", " ")})`;
      log.push(`sentiment: shadow ${note}`);
    } else {
      note = `holding ${open.direction}`;
    }
  } else {
    const direction = score >= cfg.entryThreshold ? "bullish" : score <= -cfg.entryThreshold ? "bearish" : null;
    const todays = await db.select().from(sentimentTrades)
      .where(gte(sentimentTrades.openedAt, dayStart(today))).orderBy(desc(sentimentTrades.openedAt));
    const taken = todays.filter((t) => t.status !== "skipped").length;
    const last = todays[0];
    const lastAt = last ? (last.closedAt ?? last.openedAt).getTime() : 0;
    const confirmed = !cfg.requireVwap || (vwap != null && (direction === "bullish" ? spy > vwap : spy < vwap));
    note =
      !direction ? "no signal"
      : minute < hhmmToMinutes(cfg.entryStartET) || minute > hhmmToMinutes(cfg.entryEndET) ? `${direction}, outside entry window`
      : taken >= cfg.maxTradesPerDay ? `${direction}, max trades today`
      : now - lastAt < cfg.cooldownMin * 60_000 ? `${direction}, cooling down`
      : !confirmed ? `${direction}, SPY ${direction === "bullish" ? "below" : "above"} VWAP`
      : "enter";
    if (note === "enter" && direction) {
      const account = await alpaca.getAccount();
      const budget = (Number(account.equity) * settings.options.premiumPct) / 100;
      const pick = await pickOption("SPY", direction === "bullish" ? "call" : "put", spy, settings.options, budget)
        .catch((e) => `option_chain_error: ${String(e).slice(0, 200)}`);
      const base = { direction, entryScore: score, entrySpy: spy, drivers };
      if (typeof pick === "string") {
        await db.insert(sentimentTrades).values({ ...base, status: "skipped", skipReason: pick });
        note = `${direction}, skipped (${pick.replaceAll("_", " ")})`;
      } else {
        const entryPrice = entryPriceFor(pick.bid, pick.ask);
        await db.insert(sentimentTrades).values({
          ...base, status: "open", contract: pick.contract, strike: pick.strike, expiration: pick.expiration,
          entryBid: pick.bid, entryAsk: pick.ask, entryPrice, qty: Math.max(1, Math.floor(budget / (entryPrice * 100))),
        });
        note = `opened ${direction} ${pick.contract}`;
      }
      log.push(`sentiment: shadow ${note}`);
    }
  }

  await db.insert(sentimentSnapshots).values({ score, headlines, spy, vwap: vwap ?? null, note }).onConflictDoNothing();
}

/** Everything the Sentiment page shows. */
export async function getSentimentView() {
  const [latest] = await db.select().from(sentimentSnapshots).orderBy(desc(sentimentSnapshots.t)).limit(1);
  const day = latest ? etDay(latest.t) : etDay();
  const [snapshots, trades, headlines] = await Promise.all([
    db.select().from(sentimentSnapshots).where(gte(sentimentSnapshots.t, dayStart(day))).orderBy(sentimentSnapshots.t),
    db.select().from(sentimentTrades).orderBy(desc(sentimentTrades.openedAt)).limit(100),
    db.select().from(newsScores)
      .where(and(gte(newsScores.relevance, 0.3), ne(newsScores.kind, "noise"), ne(newsScores.kind, "unscored")))
      .orderBy(desc(newsScores.publishedAt)).limit(40),
  ]);
  const closed = trades.filter((t) => t.status === "closed" && t.pnl != null);
  const moves = trades.filter((t) => t.status === "closed" && t.spyMovePct != null);
  return {
    latest: latest ?? null,
    day,
    snapshots,
    trades,
    headlines,
    stats: {
      closed: closed.length,
      wins: closed.filter((t) => t.pnl! > 0).length,
      pnl: round(closed.reduce((s, t) => s + t.pnl!, 0)),
      spyRight: moves.filter((t) => t.spyMovePct! > 0).length,
      measured: moves.length,
      avgSpyMovePct: moves.length ? round(moves.reduce((s, t) => s + t.spyMovePct!, 0) / moves.length, 3) : null,
      skipped: trades.filter((t) => t.status === "skipped").length,
    },
  };
}
