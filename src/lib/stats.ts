import { db, trades } from "./db";
import { round } from "./indicators";

export type StrategyStats = {
  strategyId: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnl: number;
  avgPnlPct: number;
};

export async function strategyStats(): Promise<StrategyStats[]> {
  const rows = await db.select().from(trades);
  const by = new Map<string, typeof rows>();
  for (const t of rows) by.set(t.strategyId, [...(by.get(t.strategyId) ?? []), t]);
  return [...by.entries()].map(([strategyId, ts]) => {
    const wins = ts.filter((t) => t.pnl > 0).length;
    return {
      strategyId,
      trades: ts.length,
      wins,
      winRate: round((wins / ts.length) * 100, 1),
      totalPnl: round(ts.reduce((a, t) => a + t.pnl, 0)),
      avgPnlPct: round(ts.reduce((a, t) => a + t.pnlPct, 0) / ts.length),
    };
  });
}
