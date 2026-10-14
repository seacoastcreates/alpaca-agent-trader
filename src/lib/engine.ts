import { and, desc, eq, gte, inArray } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { reviewEntry } from "./agent";
import { db, positions, runs, signals, strategies, trades, type Review } from "./db";
import { round, type Bar } from "./indicators";
import { getSettings } from "./settings";
import { STRATEGIES, STRATEGY_BY_ID, type Params, type Strategy } from "./strategies";
import { etDay, etMinutes, hhmmToMinutes } from "./time";

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

// ---------------------------------------------------------------------------
// Sync: reconcile our positions table with what actually happened at Alpaca
// ---------------------------------------------------------------------------

async function syncPositions(log: string[]) {
  const [ours, live] = await Promise.all([db.select().from(positions), alpaca.getPositions()]);
  const liveBySymbol = new Map(live.map((p) => [p.symbol, p]));

  for (const pos of ours) {
    const livePos = liveBySymbol.get(pos.symbol);

    if (pos.state === "pending") {
      const order = await alpaca.getOrder(pos.entryOrderId).catch(() => null);
      const filledQty = Number(order?.filled_qty ?? 0);
      if (order && (order.status === "filled" || (livePos && filledQty > 0))) {
        const entryPrice = Number(order.filled_avg_price);
        await db
          .update(positions)
          .set({ state: "open", qty: filledQty, entryPrice, highWater: entryPrice })
          .where(eq(positions.symbol, pos.symbol));
        log.push(`filled ${pos.symbol} x${filledQty} @ ${entryPrice}`);
      } else if (!order || ["canceled", "expired", "rejected"].includes(order.status)) {
        await db.delete(positions).where(eq(positions.symbol, pos.symbol));
        log.push(`entry for ${pos.symbol} ${order?.status ?? "missing"}, dropped`);
      }
      continue;
    }

    if (livePos) {
      // An exit order that got rejected/cancelled leaves us stuck in "closing"; hand it back to the exit rules.
      if (pos.state === "closing" && !(await alpaca.getOrders({ status: "open", symbols: [pos.symbol] })).length) {
        await db.update(positions).set({ state: "open", exitReason: null }).where(eq(positions.symbol, pos.symbol));
        log.push(`${pos.symbol} exit order did not complete; reopened`);
      }
      continue;
    }

    // Position is gone: find the sell that closed it (our exit, or a bracket leg).
    const orders = await alpaca.getOrders({ status: "closed", after: pos.openedAt.toISOString(), symbols: [pos.symbol] });
    const sells = orders
      .flatMap((o) => [o, ...(o.legs ?? [])])
      .filter((o) => o.side === "sell" && o.status === "filled" && o.filled_at)
      .sort((a, b) => b.filled_at!.localeCompare(a.filled_at!));
    const exit = sells[0];
    const exitPrice = exit ? Number(exit.filled_avg_price) : null;
    const entryPrice = pos.entryPrice;
    if (exitPrice && entryPrice) {
      const reason =
        pos.exitReason ??
        (exit!.type === "stop" ? "stop_loss" : exit!.type === "limit" ? "take_profit" : "external");
      await db.insert(trades).values({
        symbol: pos.symbol,
        strategyId: pos.strategyId,
        qty: pos.qty,
        entryPrice,
        exitPrice,
        pnl: round((exitPrice - entryPrice) * pos.qty),
        pnlPct: round((exitPrice / entryPrice - 1) * 100),
        exitReason: reason,
        openedAt: pos.openedAt,
        closedAt: new Date(exit!.filled_at!),
      });
      log.push(`closed ${pos.symbol} (${reason}) ${round((exitPrice / entryPrice - 1) * 100)}%`);
    } else {
      log.push(`${pos.symbol} disappeared without a matching fill; removed`);
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

  if (!dryRun) await syncPositions(log);

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
  const symbols = [...new Set([...settings.watchlist, ...ours.map((p) => p.symbol)])];
  const barsBySymbol = await alpaca.getDailyBars(symbols);
  const elapsed = Math.min(Math.max((etMinutes() - 570) / 390, 0), 1);

  // ---- Exits (run for every strategy, even disabled ones, so nothing is orphaned) ----
  for (const pos of ours) {
    if (pos.state !== "open" || !pos.entryPrice) continue;
    const def = STRATEGY_BY_ID[pos.strategyId];
    const bars = barsBySymbol[pos.symbol];
    if (!def || !bars?.length) continue;
    const params = active.find((a) => a.def.id === def.id)!.params;
    const price = bars.at(-1)!.c;
    const highWater = Math.max(pos.highWater ?? pos.entryPrice, price);
    if (!dryRun && highWater !== pos.highWater) {
      await db.update(positions).set({ highWater }).where(eq(positions.symbol, pos.symbol));
    }
    const entryDay = etDay(pos.openedAt);
    const daysHeld = bars.filter((b) => b.t.slice(0, 10) > entryDay).length;
    if (daysHeld === 0) continue; // only the protective stops act on the entry day

    const exit = def.exit({ bars, params, entryPrice: pos.entryPrice, highWater, daysHeld });
    if (!exit) continue;
    result.exits.push(`${pos.symbol} (${def.id}): ${exit.reason}`);
    if (dryRun) continue;

    try {
      await closePosition(pos.symbol);
      const livePos = live.find((p) => p.symbol === pos.symbol);
      const qty = livePos ? livePos.qty : String(pos.qty);
      const order = await alpaca.submitOrder({
        symbol: pos.symbol, qty, side: "sell", type: "market", time_in_force: "day",
        client_order_id: clientId("x", def.id, pos.symbol),
      });
      await db.update(positions).set({ state: "closing", exitReason: exit.reason }).where(eq(positions.symbol, pos.symbol));
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
    for (const symbol of settings.watchlist) {
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
  let entriesToday = todaySignals.filter((s) => s.status === "ordered").length;
  let reviewsToday = todaySignals.filter((s) => s.review).length;

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
  };

  for (const c of candidates) {
    const sid = c.strat.def.id;
    const decided = todaySignals.find(
      (s) => s.symbol === c.symbol && s.strategyId === sid && ["ordered", "vetoed", "error"].includes(s.status),
    );
    if (decided) continue; // one decision per symbol/strategy per day

    const block =
      gate ??
      (recentlyClosed.has(c.symbol) ? "cooldown" : null) ??
      (openCount >= settings.risk.maxOpenPositions ? "max_open_positions" : null) ??
      ((perStrategy.get(sid) ?? 0) >= settings.risk.maxPositionsPerStrategy ? "max_positions_per_strategy" : null) ??
      (entriesToday >= settings.risk.maxNewEntriesPerDay ? "max_entries_per_day" : null);
    if (block) {
      await record(c, "blocked", block);
      continue;
    }

    const price = c.indicators.price;
    const qty = Math.floor((equity * settings.risk.maxPositionPct) / 100 / price);
    if (qty < 1) {
      await record(c, "blocked", "position_too_small");
      continue;
    }
    if (qty * price > Number(account.buying_power)) {
      await record(c, "blocked", "insufficient_buying_power");
      continue;
    }

    // ---- Claude review ----
    let review: Review | undefined;
    if (settings.agent.enabled) {
      if (reviewsToday >= settings.agent.maxReviewsPerDay) {
        if (settings.agent.mode === "veto") {
          await record(c, "blocked", "review_budget_exhausted");
          continue;
        }
      } else {
        try {
          const news = await alpaca.getNews(c.symbol).catch(() => []);
          review = await reviewEntry({
            model: settings.agent.model, symbol: c.symbol, strategyName: c.strat.def.name,
            rules: c.strat.def.rules(c.strat.params), indicators: c.indicators, bars: c.bars, news,
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
    const legs = c.strat.def.bracket(price, c.strat.params);
    const claimed = await db
      .insert(positions)
      .values({
        symbol: c.symbol, strategyId: sid, state: "pending", qty, entryOrderId: "pending",
        stopPrice: round(legs.stopPrice), takeProfitPrice: legs.takeProfitPrice ? round(legs.takeProfitPrice) : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) continue; // another run grabbed it

    try {
      const order = await alpaca.submitOrder({
        symbol: c.symbol, qty: String(qty), side: "buy", type: "market", time_in_force: "gtc",
        client_order_id: clientId("e", sid, c.symbol),
        order_class: legs.takeProfitPrice ? "bracket" : "oto",
        stop_loss: { stop_price: round(legs.stopPrice).toFixed(2) },
        ...(legs.takeProfitPrice ? { take_profit: { limit_price: round(legs.takeProfitPrice).toFixed(2) } } : {}),
      });
      await db.update(positions).set({ entryOrderId: order.id }).where(eq(positions.symbol, c.symbol));
      await record(c, "ordered", review ? `reviewer: ${review.reason}` : null, review, order.id);
      result.entries.push(`${c.symbol} x${qty} (${sid})`);
      openCount++;
      entriesToday++;
      perStrategy.set(sid, (perStrategy.get(sid) ?? 0) + 1);
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
    await closePosition(pos.symbol);
    const livePos = live.find((p) => p.symbol === pos.symbol);
    if (!livePos) continue; // pending entry: cancelling it was enough
    await alpaca.submitOrder({
      symbol: pos.symbol, qty: livePos.qty, side: "sell", type: "market", time_in_force: "day",
      client_order_id: clientId("x", pos.strategyId, pos.symbol),
    });
    await db.update(positions).set({ state: "closing", exitReason: "manual_flatten" }).where(eq(positions.symbol, pos.symbol));
    done.push(pos.symbol);
  }
  return done;
}
