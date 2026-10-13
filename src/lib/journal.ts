import { eq, gte } from "drizzle-orm";
import { getAccount } from "./alpaca";
import { writeJournal } from "./agent";
import { db, journal, positions, signals, trades } from "./db";
import { getSettings } from "./settings";
import { strategyStats } from "./stats";
import { etDay } from "./time";

export async function runJournal(day = etDay()) {
  const settings = await getSettings();
  const since = new Date(Date.now() - 3 * 86400_000);
  const [daySignals, closed, open, account, stats] = await Promise.all([
    db.select().from(signals).where(eq(signals.day, day)),
    db.select().from(trades).where(gte(trades.closedAt, since)),
    db.select().from(positions),
    getAccount(),
    strategyStats(),
  ]);

  const facts = {
    equity: Number(account.equity),
    dayChangePct: ((Number(account.equity) / Number(account.last_equity) - 1) * 100).toFixed(2),
    entriesOrdered: daySignals.filter((s) => s.kind === "entry" && s.status === "ordered")
      .map((s) => ({ symbol: s.symbol, strategy: s.strategyId, indicators: s.indicators, reviewer: s.review?.reason })),
    exitsOrdered: daySignals.filter((s) => s.kind === "exit").map((s) => ({ symbol: s.symbol, strategy: s.strategyId, reason: s.reason })),
    vetoed: daySignals.filter((s) => s.status === "vetoed").map((s) => ({ symbol: s.symbol, strategy: s.strategyId, reason: s.reason })),
    blockedByRule: Object.entries(
      daySignals.filter((s) => s.status === "blocked").reduce<Record<string, number>>((acc, s) => {
        acc[s.reason ?? "?"] = (acc[s.reason ?? "?"] ?? 0) + 1;
        return acc;
      }, {}),
    ),
    closedTrades: closed.filter((t) => etDay(t.closedAt) === day).map((t) => ({ symbol: t.symbol, strategy: t.strategyId, pnlPct: t.pnlPct, pnl: t.pnl, reason: t.exitReason })),
    openPositions: open.map((p) => ({ symbol: p.symbol, strategy: p.strategyId, state: p.state, entry: p.entryPrice })),
    strategyScoreboardAllTime: stats,
  };

  const markdown = await writeJournal(settings.agent.model, day, facts);
  await db.insert(journal).values({ day, markdown })
    .onConflictDoUpdate({ target: journal.day, set: { markdown, createdAt: new Date() } });
  return markdown;
}
