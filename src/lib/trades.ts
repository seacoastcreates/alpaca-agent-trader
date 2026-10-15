import * as alpaca from "./alpaca";
import { db, positions, trades } from "./db";
import { round } from "./indicators";
import { STRATEGY_BY_ID } from "./strategies";
import { etDay } from "./time";

type Position = typeof positions.$inferSelect;

export const appVersion = () => process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";

const pct = (a: number, b: number) => round((a / b - 1) * 100, 3);

/** Best/worst price while held, and sessions touched, from 5-minute bars between the two fills. */
async function pathStats(symbol: string, from: Date, to: Date) {
  try {
    const bars = await alpaca.getIntradayBars(symbol, new Date(from.getTime() - 5 * 60_000).toISOString(), to.toISOString());
    if (!bars.length) return null;
    return {
      high: Math.max(...bars.map((b) => b.h)),
      low: Math.min(...bars.map((b) => b.l)),
      sessions: new Set(bars.map((b) => etDay(new Date(b.t)))).size,
    };
  } catch {
    return null;
  }
}

/**
 * Write the completed round trip. Enrichment (excursions, SPY benchmark) is best effort: a data hiccup
 * leaves those columns null, never loses the trade.
 */
export async function recordClosedTrade(pos: Position, exit: alpaca.Order) {
  const entryPrice = pos.entryPrice!;
  const exitPrice = Number(exit.filled_avg_price);
  const openedAt = pos.entryFilledAt ?? pos.openedAt;
  const closedAt = new Date(exit.filled_at!);
  const exitReason =
    pos.exitReason ?? (exit.type === "stop" ? "stop_loss" : exit.type === "limit" ? "take_profit" : "external");

  const [path, spyEntry, spyExit] = await Promise.all([
    pathStats(pos.symbol, openedAt, closedAt),
    alpaca.priceAt("SPY", openedAt).catch(() => null),
    alpaca.priceAt("SPY", closedAt).catch(() => null),
  ]);

  const pnlPct = pct(exitPrice, entryPrice);
  const riskPerShare = pos.stopPrice ? round(entryPrice - pos.stopPrice, 4) : null;
  const spyReturnPct = spyEntry && spyExit ? pct(spyExit, spyEntry) : null;
  const notional = round(entryPrice * pos.qty);
  const r = pos.review;

  const values: typeof trades.$inferInsert = {
    symbol: pos.symbol,
    sector: pos.sector,
    strategyId: pos.strategyId,
    strategyName: STRATEGY_BY_ID[pos.strategyId]?.name ?? null,
    params: pos.params,
    appVersion: pos.appVersion,
    qty: pos.qty,
    entryNotional: notional,
    equityAtEntry: pos.equityAtEntry,
    positionPct: pos.equityAtEntry ? round((notional / pos.equityAtEntry) * 100) : null,
    entrySignalId: pos.signalId,
    entrySignalAt: pos.signalAt,
    entrySignalPrice: pos.signalPrice,
    entryIndicators: pos.entryIndicators,
    entryOrderId: pos.entryOrderId,
    openedAt,
    entryPrice,
    entrySlippagePct: pos.signalPrice ? pct(entryPrice, pos.signalPrice) : null,
    stopPrice: pos.stopPrice,
    takeProfitPrice: pos.takeProfitPrice,
    riskPerShare,
    exitReason,
    exitSignalAt: pos.exitSignalAt,
    exitSignalPrice: pos.exitSignalPrice,
    exitIndicators: pos.exitIndicators,
    exitOrderId: exit.id,
    exitOrderType: exit.type,
    closedAt,
    exitPrice,
    exitSlippagePct: pos.exitSignalPrice ? round(-pct(exitPrice, pos.exitSignalPrice), 3) : null,
    pnl: round((exitPrice - entryPrice) * pos.qty),
    pnlPct,
    rMultiple: riskPerShare ? round((exitPrice - entryPrice) / riskPerShare) : null,
    holdMinutes: Math.round((closedAt.getTime() - openedAt.getTime()) / 60_000),
    holdSessions: path?.sessions ?? null,
    mfePct: path ? pct(Math.max(path.high, exitPrice, entryPrice), entryPrice) : null,
    maePct: path ? pct(Math.min(path.low, exitPrice, entryPrice), entryPrice) : null,
    spyEntryPrice: spyEntry,
    spyExitPrice: spyExit,
    spyReturnPct,
    excessReturnPct: spyReturnPct != null ? round(pnlPct - spyReturnPct, 3) : null,
    reviewDecision: r?.decision ?? null,
    reviewConfidence: r?.confidence ?? null,
    reviewReason: r?.reason ?? null,
    reviewModel: r?.model ?? null,
    review: r,
  };
  await db.insert(trades).values(values);
  return { exitReason, pnlPct };
}
