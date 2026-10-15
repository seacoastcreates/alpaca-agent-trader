import { and, desc, eq, gte, inArray } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { reviewEntry } from "./agent";
import { db, positions, runs, signals, strategies, trades, type Review } from "./db";
import { appVersion, recordClosedTrade } from "./trades";
import { round, type Bar } from "./indicators";
import { daysUntil, pickCall, type CallPick } from "./options";
import { getSettings, type Settings } from "./settings";
import type { ExitSignal } from "./strategies/types";
import { STRATEGIES, STRATEGY_BY_ID, type Params, type Strategy } from "./strategies";
import { etDay, etMinutes, hhmmToMinutes } from "./time";
import { sectorOf } from "./sectors";
import { scanList } from "./universe";

// Each review takes a few seconds; leave the rest for the next tick so a run stays well under the time limit.
const MAX_REVIEWS_PER_TICK = 4;

type ActiveStrategy = { def: Strategy; enabled: boolean; params: Params };

export async function loadStrategies(): Promise<ActiveStrategy[]> {
  const rows = await db.select().from(strategies);
  const missing = STRATEGIES.filter((s) => !rows.some((r) => r.id === s.id));
  if (missing.length) {
    await db
      .insert(strategies)
      .values(missing.map((s) => ({ id: s.id, enabled: true, params: s.defaultParams })))
      .onConflictDoNothing();
  }
  return STRATEGIES.map((def) => {
    const row = rows.find((r) => r.id === def.id);
    return { def, enabled: row?.enabled ?? true, params: { ...def.defaultParams, ...row?.params } };
  });
}

const clientId = (kind: "e" | "x", strategyId: string, symbol: string) =>
  `aat-${kind}-${strategyId}-${symbol}-${Date.now()}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Position = typeof positions.$inferSelect;
/** What gets traded at Alpaca: the option contract for calls, the ticker for shares. */
const orderSymbol = (p: Position) => p.contract ?? p.symbol;

// Option prices trade in $0.05 steps at $3 and above, $0.01 below (penny-pilot names allow pennies throughout,
// so these are always valid). Buys round up, sells round down, so the limit stays marketable.
function optionTick(price: number, dir: "up" | "down") {
  const tick = price >= 3 ? 0.05 : 0.01;
  const n = price / tick;
  return round((dir === "up" ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9)) * tick);
}

// Underlyings with no usable calls are re-checked at most every 30 minutes.
const noCallCache = new Map<string, { reason: string; at: number }>();

// ---------------------------------------------------------------------------
// Sync: reconcile our positions table with what actually happened at Alpaca
// ---------------------------------------------------------------------------

async function syncPositions(log: string[], settings: Settings) {
  const [ours, live] = await Promise.all([db.select().from(positions), alpaca.getPositions()]);
  const liveBySymbol = new Map(live.map((p) => [p.symbol, p]));

  for (const pos of ours) {
    const sym = orderSymbol(pos);
    const livePos = liveBySymbol.get(sym);

    if (pos.state === "pending") {
      const order = await alpaca.getOrder(pos.entryOrderId).catch(() => null);
      const filledQty = Number(order?.filled_qty ?? 0);
      if (order && (order.status === "filled" || (livePos && filledQty > 0))) {
        const entryPrice = Number(order.filled_avg_price);
        if (["new", "accepted", "partially_filled"].includes(order.status)) await alpaca.cancelOrder(order.id).catch(() => undefined);
        await db
          .update(positions)
          .set({
            state: "open", qty: filledQty, entryPrice,
            highWater: pos.instrument === "call" ? pos.underlyingEntryPrice : entryPrice,
            entryFilledAt: order.filled_at ? new Date(order.filled_at) : new Date(),
          })
          .where(eq(positions.symbol, pos.symbol));
        log.push(`filled ${sym} x${filledQty} @ ${entryPrice}`);
      } else if (!order || ["canceled", "expired", "rejected"].includes(order.status)) {
        await db.delete(positions).where(eq(positions.symbol, pos.symbol));
        log.push(`entry for ${sym} ${order?.status ?? "missing"}, dropped`);
      } else if (
        pos.instrument === "call" && pos.signalAt &&
        Date.now() - pos.signalAt.getTime() > settings.options.entryTimeoutMin * 60_000
      ) {
        // Don't chase: an unfilled limit buy is cancelled and dropped on the next sync.
        await alpaca.cancelOrder(order.id).catch(() => undefined);
        log.push(`entry for ${sym} unfilled after ${settings.options.entryTimeoutMin} min, cancelling`);
      }
      continue;
    }

    if (livePos) {
      if (pos.state === "closing") {
        const open = await alpaca.getOrders({ status: "open", symbols: [sym] });
        if (!open.length) {
          // An exit order that got rejected/cancelled leaves us stuck in "closing"; hand it back to the exit rules,
          // which re-submit at a fresh price if the exit condition still holds.
          await db.update(positions).set({ state: "open", exitReason: null }).where(eq(positions.symbol, pos.symbol));
          log.push(`${sym} exit order did not complete; reopened`);
        } else if (pos.instrument === "call" && pos.exitSignalAt && Date.now() - pos.exitSignalAt.getTime() > 2 * 60_000) {
          // Limit sell at the bid hasn't filled: cancel so the next tick re-prices it.
          await Promise.all(open.map((o) => alpaca.cancelOrder(o.id).catch(() => undefined)));
          log.push(`${sym} exit unfilled after 2 min, re-pricing`);
        }
      }
      continue;
    }

    // Position is gone: find the sell that closed it (our exit, or a bracket leg).
    const orders = await alpaca.getOrders({ status: "closed", after: pos.openedAt.toISOString(), symbols: [sym] });
    const sells = orders
      .flatMap((o) => [o, ...(o.legs ?? [])])
      .filter((o) => o.side === "sell" && o.status === "filled" && o.filled_at)
      .sort((a, b) => b.filled_at!.localeCompare(a.filled_at!));
    const exit = sells[0];
    if (exit && pos.entryPrice) {
      const { exitReason, pnlPct } = await recordClosedTrade(pos, exit);
      log.push(`closed ${sym} (${exitReason}) ${pnlPct}%`);
    } else {
      log.push(`${sym} disappeared without a matching fill; removed`);
    }
    await db.delete(positions).where(eq(positions.symbol, pos.symbol));
  }
}

// ---------------------------------------------------------------------------
// Exits
// ---------------------------------------------------------------------------

async function closePosition(symbol: string) {
  // Cancel the protective bracket legs first, otherwise the shares are "held" and the sell is rejected.
  const open = await alpaca.getOrders({ status: "open", symbols: [symbol] });
  const ids = open.flatMap((o) => [o.id, ...(o.legs ?? []).map((l) => l.id)]);
  await Promise.all(ids.map((id) => alpaca.cancelOrder(id).catch(() => undefined)));
  for (let i = 0; i < 8; i++) {
    const still = await alpaca.getOrders({ status: "open", symbols: [symbol] });
    if (!still.length) break;
    await sleep(500);
  }
}

/**
 * Share of a normal day's volume we'd expect to have traded so far. 1 when the last bar is a completed session
 * (pre-market, after the close, or a symbol with no trades yet today). Volume is front-loaded at the open, so a
 * straight time fraction would overstate early-session volume; elapsed^0.7 roughly tracks the intraday curve
 * (~17% of volume by 10:00 ET, ~60% by 12:45).
 */
export function sessionVolumeShare(bars: Bar[], today: string, isOpen: boolean, elapsed: number) {
  const lastIsToday = bars.at(-1)?.t.slice(0, 10) === today;
  if (!isOpen || !lastIsToday) return 1;
  return Math.max(elapsed ** 0.7, 0.05);
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------

export type TickResult = {
  runId?: number;
  status: string;
  gate: string | null;
  equity?: number;
  dayPnlPct?: number;
  exits: string[];
  entries: string[];
  candidates: { symbol: string; strategy: string; score: number; indicators: Record<string, number> }[];
  log: string[];
};

export async function tick(trigger: string, opts: { dryRun?: boolean } = {}): Promise<TickResult> {
  const dryRun = !!opts.dryRun;
  const result: TickResult = { status: "ok", gate: null, exits: [], entries: [], candidates: [], log: [] };

  // Skip if another run started in the last 2 minutes and hasn't finished (cron + manual overlap).
  if (!dryRun) {
    const recent = await db.query.runs.findFirst({ where: eq(runs.status, "running"), orderBy: desc(runs.startedAt) });
    if (recent && Date.now() - recent.startedAt.getTime() < 120_000) {
      return { ...result, status: "skipped_overlap" };
    }
    const [run] = await db.insert(runs).values({ trigger, status: "running" }).returning({ id: runs.id });
    result.runId = run.id;
  }

  try {
    await runTick(result, dryRun);
  } catch (err) {
    result.status = "error";
    result.log.push(String(err instanceof Error ? err.message : err));
    if (result.runId) {
      await db
        .update(runs)
        .set({ status: "error", finishedAt: new Date(), error: String(err), summary: summarize(result) })
        .where(eq(runs.id, result.runId));
    }
    throw err;
  }

  if (result.runId) {
    await db
      .update(runs)
      .set({ status: result.status, finishedAt: new Date(), summary: summarize(result) })
      .where(eq(runs.id, result.runId));
  }
  return result;
}

function summarize(r: TickResult) {
  return {
    gate: r.gate, equity: r.equity, dayPnlPct: r.dayPnlPct,
    exits: r.exits, entries: r.entries, candidates: r.candidates.length, log: r.log.slice(0, 50),
  };
}

async function runTick(result: TickResult, dryRun: boolean) {
  const { log } = result;
  const settings = await getSettings();
  const active = await loadStrategies();
  const clock = await alpaca.getClock();

  if (!dryRun) await syncPositions(log, settings);

  if (!clock.is_open && !dryRun) {
    result.status = "market_closed";
    return;
  }

  const today = etDay();
  const account = await alpaca.getAccount();
  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  const dayPnlPct = lastEquity ? ((equity - lastEquity) / lastEquity) * 100 : 0;
  result.equity = equity;
  result.dayPnlPct = round(dayPnlPct);

  const [ours, live] = await Promise.all([db.select().from(positions), alpaca.getPositions()]);
  const liveSymbols = new Set(live.map((p) => p.symbol));
  const { symbols: scan, sectors } = await scanList(settings);
  const symbols = [...new Set([...scan, ...ours.map((p) => p.symbol)])];
  const barsBySymbol = await alpaca.getDailyBars(symbols);
  const elapsed = Math.min(Math.max((etMinutes() - 570) / 390, 0), 1);

  // Current quotes for held calls (one request), used by the premium stop/target.
  const callContracts = ours.filter((p) => p.instrument === "call" && p.contract).map((p) => p.contract!);
  const optionQuotes = await alpaca.getOptionSnapshots(callContracts).catch(() => ({} as Record<string, alpaca.OptionSnapshot>));

  // ---- Exits (run for every strategy, even disabled ones, so nothing is orphaned) ----
  for (const pos of ours) {
    if (pos.state !== "open" || !pos.entryPrice) continue;
    const def = STRATEGY_BY_ID[pos.strategyId];
    const bars = barsBySymbol[pos.symbol];
    if (!def || !bars?.length) continue;
    const params = active.find((a) => a.def.id === def.id)!.params;
    const isCall = pos.instrument === "call";
    const price = bars.at(-1)!.c; // underlying
    const underlyingEntry = isCall ? (pos.underlyingEntryPrice ?? price) : pos.entryPrice;
    const highWater = Math.max(pos.highWater ?? underlyingEntry, price);
    if (!dryRun && highWater !== pos.highWater) {
      await db.update(positions).set({ highWater }).where(eq(positions.symbol, pos.symbol));
    }
    const entryDay = etDay(pos.openedAt);
    const daysHeld = bars.filter((b) => b.t.slice(0, 10) > entryDay).length;
    const bid = isCall ? optionQuotes[pos.contract!]?.latestQuote?.bp : undefined;

    // Calls have no stop orders at the broker, so their protective exits are checked here every tick.
    let exit: ExitSignal | null = null;
    if (isCall) {
      const o = settings.options;
      const dte = pos.expiration ? daysUntil(pos.expiration) : Infinity;
      const ind = { price, ...(bid ? { bid } : {}), entry: pos.entryPrice, dte };
      if (dte <= o.closeAtDte) exit = { reason: "expiry_close", indicators: ind };
      else if (pos.stopPrice && price <= pos.stopPrice) exit = { reason: "underlying_stop", indicators: { ...ind, stop: pos.stopPrice } };
      else if (pos.takeProfitPrice && price >= pos.takeProfitPrice)
        exit = { reason: "underlying_target", indicators: { ...ind, target: pos.takeProfitPrice } };
      else if (bid && bid <= pos.entryPrice * (1 - o.premiumStopPct / 100)) exit = { reason: "premium_stop", indicators: ind };
      else if (bid && bid >= pos.entryPrice * (1 + o.premiumTargetPct / 100)) exit = { reason: "premium_target", indicators: ind };
    }
    // Strategy exit rules wait a day; on the entry day only the protective exits act.
    if (!exit && daysHeld > 0) exit = def.exit({ bars, params, entryPrice: underlyingEntry, highWater, daysHeld });
    if (!exit) continue;
    result.exits.push(`${orderSymbol(pos)} (${def.id}): ${exit.reason}`);
    if (dryRun) continue;

    try {
      const sym = orderSymbol(pos);
      await closePosition(sym);
      const livePos = live.find((p) => p.symbol === sym);
      const qty = livePos ? livePos.qty : String(pos.qty);
      const limit = isCall && bid ? optionTick(bid, "down") : undefined;
      const order = await alpaca.submitOrder({
        symbol: sym, qty, side: "sell", time_in_force: "day", client_order_id: clientId("x", def.id, pos.symbol),
        ...(limit ? { type: "limit", limit_price: limit.toFixed(2) } : { type: "market" }),
      });
      await db.update(positions).set({
        state: "closing", exitReason: exit.reason, exitSignalAt: new Date(),
        exitSignalPrice: isCall ? (bid ?? null) : price, // same units as the fill, for slippage
        exitIndicators: exit.indicators, exitOrderId: order.id,
      }).where(eq(positions.symbol, pos.symbol));
      await db.insert(signals).values({
        day: today, runId: result.runId, symbol: pos.symbol, strategyId: def.id, kind: "exit",
        price, indicators: exit.indicators, status: "ordered", reason: exit.reason, orderId: order.id,
      });
    } catch (err) {
      log.push(`exit ${pos.symbol} failed: ${err}`);
      await db.insert(signals).values({
        day: today, runId: result.runId, symbol: pos.symbol, strategyId: def.id, kind: "exit",
        price, indicators: exit.indicators, status: "error", reason: String(err).slice(0, 500),
      });
    }
  }

  // ---- Entry gate ----
  const now = etMinutes();
  const gate = settings.killSwitch
    ? "kill_switch"
    : dayPnlPct <= -settings.risk.dailyLossLimitPct
      ? "daily_loss_limit"
      : account.trading_blocked
        ? "account_blocked"
        : now < hhmmToMinutes(settings.risk.entryStartET) || now > hhmmToMinutes(settings.risk.entryEndET)
          ? "outside_entry_window"
          : null;
  result.gate = gate;

  // ---- Candidates ----
  const held = new Set([...ours.map((p) => p.symbol), ...liveSymbols]);
  const raw: { strat: ActiveStrategy; symbol: string; bars: Bar[]; score: number; indicators: Record<string, number> }[] = [];
  for (const strat of active.filter((a) => a.enabled)) {
    for (const symbol of scan) {
      const bars = barsBySymbol[symbol];
      if (held.has(symbol) || !bars || bars.length < 30) continue;
      if (bars.at(-1)!.c < settings.risk.minPrice) continue;
      const sessionFraction = sessionVolumeShare(bars, today, clock.is_open, elapsed);
      const sig = strat.def.entry({ bars, params: strat.params, sessionFraction });
      if (sig) raw.push({ strat, symbol, bars, ...sig });
    }
  }
  // One owner per symbol; strongest signal first.
  raw.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const candidates = raw.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)));
  result.candidates = candidates.map((c) => ({
    symbol: c.symbol, strategy: c.strat.def.id, score: round(c.score), indicators: c.indicators,
  }));
  if (dryRun || !candidates.length) return;

  // ---- Risk + review + order ----
  const todaySignals = await db.select().from(signals).where(and(eq(signals.day, today), eq(signals.kind, "entry")));
  const cooldownSince = new Date(Date.now() - settings.risk.cooldownDays * 86400_000);
  const recentlyClosed = new Set(
    (await db.select({ symbol: trades.symbol }).from(trades).where(gte(trades.closedAt, cooldownSince))).map((t) => t.symbol),
  );
  let openCount = ours.length;
  const perStrategy = new Map<string, number>();
  for (const p of ours) perStrategy.set(p.strategyId, (perStrategy.get(p.strategyId) ?? 0) + 1);
  const perSector = new Map<string, number>();
  for (const p of ours) {
    const sec = p.sector ?? sectorOf(p.symbol, sectors);
    perSector.set(sec, (perSector.get(sec) ?? 0) + 1);
  }
  let entriesToday = todaySignals.filter((s) => s.status === "ordered").length;
  let reviewsToday = todaySignals.filter((s) => s.review).length;
  let reviewsThisTick = 0;

  const record = async (
    c: (typeof candidates)[number], status: string, reason: string | null, review?: Review, orderId?: string,
  ) => {
    // Blocked signals repeat every tick; keep one row per symbol/strategy/reason per day.
    if (status === "blocked" && todaySignals.some((s) => s.symbol === c.symbol && s.strategyId === c.strat.def.id && s.reason === reason)) return;
    const [row] = await db.insert(signals).values({
      day: today, runId: result.runId, symbol: c.symbol, strategyId: c.strat.def.id, kind: "entry",
      price: c.indicators.price, indicators: c.indicators, status, reason, review, orderId,
    }).returning();
    todaySignals.push(row);
    return row;
  };

  for (const c of candidates) {
    const sid = c.strat.def.id;
    const sector = sectorOf(c.symbol, sectors);
    const decided = todaySignals.find(
      (s) => s.symbol === c.symbol && s.strategyId === sid && ["ordered", "vetoed", "error"].includes(s.status),
    );
    if (decided) continue; // one decision per symbol/strategy per day

    const block =
      gate ??
      (recentlyClosed.has(c.symbol) ? "cooldown" : null) ??
      (openCount >= settings.risk.maxOpenPositions ? "max_open_positions" : null) ??
      ((perStrategy.get(sid) ?? 0) >= settings.risk.maxPositionsPerStrategy ? "max_positions_per_strategy" : null) ??
      ((perSector.get(sector) ?? 0) >= settings.risk.maxPositionsPerSector ? `max_positions_per_sector (${sector})` : null) ??
      (entriesToday >= settings.risk.maxNewEntriesPerDay ? "max_entries_per_day" : null);
    if (block) {
      await record(c, "blocked", block);
      continue;
    }

    const price = c.indicators.price;
    const calls = settings.instrument === "calls";
    let pick: CallPick | undefined;
    let qty: number;
    if (calls) {
      const cached = noCallCache.get(c.symbol);
      if (cached && Date.now() - cached.at < 30 * 60_000) {
        await record(c, "blocked", cached.reason);
        continue;
      }
      const budget = (equity * settings.options.premiumPct) / 100;
      const r = await pickCall(c.symbol, price, settings.options, budget).catch((e) => `option_chain_error: ${String(e).slice(0, 200)}`);
      if (typeof r === "string") {
        if (!r.startsWith("option_chain_error")) noCallCache.set(c.symbol, { reason: r, at: Date.now() });
        await record(c, "blocked", r);
        continue;
      }
      pick = r;
      qty = Math.floor(budget / (r.ask * 100));
      if (qty * r.ask * 100 > Number(account.options_buying_power ?? account.buying_power)) {
        await record(c, "blocked", "insufficient_options_buying_power");
        continue;
      }
    } else {
      qty = Math.floor((equity * settings.risk.maxPositionPct) / 100 / price);
      if (qty < 1) {
        await record(c, "blocked", "position_too_small");
        continue;
      }
      if (qty * price > Number(account.buying_power)) {
        await record(c, "blocked", "insufficient_buying_power");
        continue;
      }
    }
    const instrumentNote = pick
      ? `Buying ${qty} x ${pick.contract} (${c.symbol} $${pick.strike} call, expires ${pick.expiration}, ${pick.dte} days, ` +
        `delta ${pick.delta.toFixed(2)}, IV ${pick.iv != null ? (pick.iv * 100).toFixed(0) + "%" : "n/a"}) for about ` +
        `$${round(qty * pick.ask * 100, 0)} of premium. Flag an earnings date or other binary event before expiration.`
      : undefined;

    // ---- Claude review ----
    let review: Review | undefined;
    if (settings.agent.enabled) {
      if (reviewsToday >= settings.agent.maxReviewsPerDay) {
        if (settings.agent.mode === "veto") {
          await record(c, "blocked", "review_budget_exhausted");
          continue;
        }
      } else if (reviewsThisTick >= MAX_REVIEWS_PER_TICK) {
        continue; // picked up again next tick
      } else {
        try {
          reviewsThisTick++;
          const news = await alpaca.getNews(c.symbol).catch(() => []);
          review = await reviewEntry({
            model: settings.agent.model, symbol: c.symbol, strategyName: c.strat.def.name,
            rules: c.strat.def.rules(c.strat.params), indicators: c.indicators, bars: c.bars, news, instrumentNote,
          });
          reviewsToday++;
        } catch (err) {
          log.push(`review ${c.symbol} failed: ${err}`);
          if (settings.agent.mode === "veto") {
            // Fail closed: no review, no trade.
            await record(c, "error", `review failed: ${String(err).slice(0, 300)}`);
            continue;
          }
        }
        if (review?.decision === "veto" && settings.agent.mode === "veto") {
          await record(c, "vetoed", review.reason, review);
          continue;
        }
      }
    }

    // ---- Order ----
    // Stop/target levels are on the underlying: broker-held bracket legs for shares, checked each tick for calls.
    const legs = c.strat.def.bracket(price, c.strat.params);
    const optionParams = Object.fromEntries(Object.entries(settings.options).map(([k, v]) => [`opt_${k}`, v]));
    const claimed = await db
      .insert(positions)
      .values({
        symbol: c.symbol, strategyId: sid, sector, state: "pending", qty, entryOrderId: "pending",
        stopPrice: round(legs.stopPrice), takeProfitPrice: legs.takeProfitPrice ? round(legs.takeProfitPrice) : null,
        signalAt: new Date(), signalPrice: pick ? pick.ask : price,
        entryIndicators: pick ? { ...c.indicators, bid: pick.bid, ask: pick.ask, delta: round(pick.delta, 3) } : c.indicators,
        params: pick ? { ...c.strat.params, ...optionParams } : c.strat.params,
        review, equityAtEntry: equity, appVersion: appVersion(),
        ...(pick && {
          instrument: "call", contract: pick.contract, multiplier: 100, strike: pick.strike, expiration: pick.expiration,
          entryDelta: round(pick.delta, 3), entryIv: pick.iv, underlyingEntryPrice: price, highWater: price,
        }),
      })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) continue; // another run grabbed it

    try {
      const order = pick
        ? await alpaca.submitOrder({
            symbol: pick.contract, qty: String(qty), side: "buy", type: "limit",
            limit_price: optionTick(pick.ask, "up").toFixed(2), time_in_force: "day",
            client_order_id: clientId("e", sid, c.symbol),
          })
        : await alpaca.submitOrder({
            symbol: c.symbol, qty: String(qty), side: "buy", type: "market", time_in_force: "gtc",
            client_order_id: clientId("e", sid, c.symbol),
            order_class: legs.takeProfitPrice ? "bracket" : "oto",
            stop_loss: { stop_price: round(legs.stopPrice).toFixed(2) },
            ...(legs.takeProfitPrice ? { take_profit: { limit_price: round(legs.takeProfitPrice).toFixed(2) } } : {}),
          });
      const sig = await record(c, "ordered", review ? `reviewer: ${review.reason}` : null, review, order.id);
      await db.update(positions).set({ entryOrderId: order.id, signalId: sig?.id }).where(eq(positions.symbol, c.symbol));
      result.entries.push(`${pick ? pick.contract : c.symbol} x${qty} (${sid})`);
      openCount++;
      entriesToday++;
      perStrategy.set(sid, (perStrategy.get(sid) ?? 0) + 1);
      perSector.set(sector, (perSector.get(sector) ?? 0) + 1);
    } catch (err) {
      await db.delete(positions).where(eq(positions.symbol, c.symbol));
      await record(c, "error", String(err).slice(0, 500), review);
      log.push(`order ${c.symbol} failed: ${err}`);
    }
  }
}

/** Close every bot-owned position now (manual "flatten" button). */
export async function flattenAll(): Promise<string[]> {
  const ours = await db.select().from(positions).where(inArray(positions.state, ["open", "pending"]));
  const live = await alpaca.getPositions();
  const done: string[] = [];
  for (const pos of ours) {
    const sym = orderSymbol(pos);
    await closePosition(sym);
    const livePos = live.find((p) => p.symbol === sym);
    if (!livePos) continue; // pending entry: cancelling it was enough
    const order = await alpaca.submitOrder({
      symbol: sym, qty: livePos.qty, side: "sell", type: "market", time_in_force: "day",
      client_order_id: clientId("x", pos.strategyId, pos.symbol),
    });
    await db.update(positions).set({
      state: "closing", exitReason: "manual_flatten", exitSignalAt: new Date(),
      exitSignalPrice: Number(livePos.current_price), exitOrderId: order.id,
    }).where(eq(positions.symbol, pos.symbol));
    done.push(sym);
  }
  return done;
}
