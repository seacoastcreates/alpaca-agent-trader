import { and, eq, inArray } from "drizzle-orm";
import * as alpaca from "./alpaca";
import { db, signals, trades } from "./db";
import { equityHistory } from "./equity";
import { round, type Bar } from "./indicators";
import { getSettings } from "./settings";
import { STRATEGY_BY_ID } from "./strategies";

// Insights into the bot's real trading on this account: the `trades` table (one row per round trip),
// the `signals` table (what was vetoed or blocked) and the account's equity history.

/** Sessions after a signal at which vetoed and taken signals are compared. About the rules' typical hold. */
const HORIZON = 3;
const ET = "America/New_York";

type Trade = typeof trades.$inferSelect;

export type Group = { key: string; trades: number; winRate: number; pnl: number; avgPct: number };

export type PerfTrade = {
  id: number;
  symbol: string;
  strategy: string;
  instrument: string;
  openedAt: string;
  closedAt: string;
  pnl: number;
  pnlPct: number;
  /** The stock's move over the hold, signed so that + is the direction the rule bet on. */
  stockMovePct: number | null;
  exitReason: string;
  holdSessions: number | null;
  review: string | null;
};

export type SignalOutcome = { label: string; total: number; matured: number; wentRight: number; avgMovePct: number | null };

export type Performance = {
  since: string | null;
  summary: {
    trades: number;
    netPnl: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number | null;
    expectancy: number; // average $ per trade
  };
  account: { startEquity: number; equity: number; returnPct: number; spyReturnPct: number | null; maxDrawdownPct: number };
  curve: { date: string; account: number; SPY?: number }[];
  findings: string[];
  groups: { title: string; note?: string; rows: Group[] }[];
  /** Did the stock go the rule's way, and what did the options turn that into? */
  vsStock: {
    measured: number;
    stockRight: number;
    optionWon: number;
    stockRightButLost: number;
    avgStockMovePct: number;
    sharesPnl: number; // the same moves at the shares-mode position size
    sharesPositionPct: number;
  } | null;
  claude: { minConfidence: number | null; maxConfidence: number | null; outcomes: SignalOutcome[] };
  blocked: { reason: string; count: number; days: number }[];
  trades: PerfTrade[];
};

const etHour = (d: Date) => Number(d.toLocaleString("en-US", { timeZone: ET, hour: "numeric", hourCycle: "h23" }));
const etDayOf = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0);
const avg = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const signed = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;

/** + when the stock moved the way the rule bet. Shares trades fall back to their own return. */
function stockMove(t: Trade) {
  const raw = t.underlyingReturnPct ?? (t.instrument === "shares" ? t.pnlPct : null);
  if (raw == null) return null;
  return t.direction === "bearish" ? -raw : raw;
}

function group(rows: Trade[], keyOf: (t: Trade) => string, order?: string[]): Group[] {
  const by = new Map<string, Trade[]>();
  for (const t of rows) by.set(keyOf(t), [...(by.get(keyOf(t)) ?? []), t]);
  const out = [...by.entries()].map(([key, ts]) => ({
    key,
    trades: ts.length,
    winRate: round((ts.filter((t) => t.pnl > 0).length / ts.length) * 100, 1),
    pnl: round(sum(ts.map((t) => t.pnl))),
    avgPct: round(avg(ts.map((t) => t.pnlPct))),
  }));
  return order
    ? out.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
    : out.sort((a, b) => a.pnl - b.pnl);
}

const clock = (h: number) => `${h > 12 ? h - 12 : h}${h >= 12 ? "pm" : "am"}`;
const hourLabel = (h: number) => `${clock(h)}-${clock(h + 1)}`;
const hourBucket = (t: Trade) => hourLabel(etHour(t.openedAt));
const HOLD_ORDER = ["Same day", "1 night", "2+ nights"];
const holdBucket = (t: Trade) => (t.holdSessions == null || t.holdSessions <= 1 ? "Same day" : t.holdSessions === 2 ? "1 night" : "2+ nights");

function maxDrawdownPct(values: number[]) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v / peak - 1);
  }
  return round(worst * 100);
}

/**
 * For each signal, the stock's move from the signal price to the close `HORIZON` sessions later, signed so + is the
 * rule's direction. Signals too recent to have that many sessions count as not matured.
 */
async function signalOutcomes(rows: (typeof signals.$inferSelect)[]) {
  if (!rows.length) return new Map<number, number | null>();
  const start = rows.map((r) => r.day).sort()[0];
  const bars = await alpaca.fetchDailyBars([...new Set(rows.map((r) => r.symbol))], start);
  return new Map(
    rows.map((r) => {
      const after = (bars[r.symbol] ?? []).filter((b) => b.t.slice(0, 10) > r.day);
      const bar = after[HORIZON - 1];
      if (!bar) return [r.id, null];
      const move = (bar.c / r.price - 1) * 100;
      return [r.id, STRATEGY_BY_ID[r.strategyId]?.direction === "bearish" ? -move : move];
    }),
  );
}

function outcome(label: string, rows: (typeof signals.$inferSelect)[], moves: Map<number, number | null>): SignalOutcome {
  const matured = rows.map((r) => moves.get(r.id)).filter((m): m is number => m != null);
  return {
    label,
    total: rows.length,
    matured: matured.length,
    wentRight: matured.filter((m) => m > 0).length,
    avgMovePct: matured.length ? round(avg(matured)) : null,
  };
}

export async function getPerformance(): Promise<Performance> {
  const [rows, settings, equity, reviewed, blockedRows] = await Promise.all([
    db.select().from(trades).orderBy(trades.openedAt),
    getSettings(),
    equityHistory("3M").catch(() => []),
    db.select().from(signals).where(and(eq(signals.kind, "entry"), inArray(signals.status, ["ordered", "vetoed"]))),
    db.select({ reason: signals.reason, day: signals.day }).from(signals).where(eq(signals.status, "blocked")),
  ]);

  // ---- Summary ----
  const wins = rows.filter((t) => t.pnl > 0);
  const losses = rows.filter((t) => t.pnl < 0);
  const grossWin = sum(wins.map((t) => t.pnl));
  const grossLoss = -sum(losses.map((t) => t.pnl));
  const netPnl = round(sum(rows.map((t) => t.pnl)));
  const summary = {
    trades: rows.length,
    netPnl,
    winRate: rows.length ? round((wins.length / rows.length) * 100, 1) : 0,
    avgWin: round(avg(wins.map((t) => t.pnl))),
    avgLoss: round(avg(losses.map((t) => t.pnl))),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    expectancy: rows.length ? round(netPnl / rows.length) : 0,
  };

  // ---- Account vs SPY (daily points from the dashboard's equity history) ----
  const daily = new Map<string, number>();
  for (const p of equity) daily.set(new Date(p.t).toISOString().slice(0, 10), p.equity);
  const days = [...daily.keys()].sort();
  const spyBars = days.length ? await alpaca.fetchDailyBars(["SPY"], days[0]).catch(() => ({} as Record<string, Bar[]>)) : {};
  const spyClose = new Map((spyBars.SPY ?? []).map((b) => [b.t.slice(0, 10), b.c]));
  const startEquity = daily.get(days[0]) ?? 0;
  const spyStart = spyClose.get(days[0]);
  const curve = days.map((d) => {
    const spy = spyClose.get(d);
    return {
      date: d,
      account: round((daily.get(d)! / startEquity - 1) * 100),
      ...(spy && spyStart ? { SPY: round((spy / spyStart - 1) * 100) } : {}),
    };
  });
  const lastEquity = daily.get(days.at(-1)!) ?? startEquity;
  const lastSpy = [...curve].reverse().find((c) => c.SPY != null)?.SPY ?? null;
  const account = {
    startEquity,
    equity: lastEquity,
    returnPct: startEquity ? round((lastEquity / startEquity - 1) * 100) : 0,
    spyReturnPct: lastSpy,
    maxDrawdownPct: maxDrawdownPct(days.map((d) => daily.get(d)!)),
  };

  // ---- Breakdowns ----
  const nameOf = (t: Trade) => t.strategyName ?? STRATEGY_BY_ID[t.strategyId]?.name ?? t.strategyId;
  const hours = [...new Set(rows.map((t) => etHour(t.openedAt)))].sort((a, b) => a - b);
  const hourOrder = hours.map(hourLabel);
  const groups: Performance["groups"] = [
    { title: "By strategy", rows: group(rows, nameOf) },
    { title: "By entry time (ET)", rows: group(rows, hourBucket, hourOrder) },
    { title: "By exit reason", rows: group(rows, (t) => t.exitReason) },
    { title: "By hold", rows: group(rows, holdBucket, HOLD_ORDER) },
    { title: "By instrument", rows: group(rows, (t) => t.instrument) },
  ];

  // ---- The stock's move vs what the trade made ----
  const measured = rows.map((t) => ({ t, move: stockMove(t) })).filter((x): x is { t: Trade; move: number } => x.move != null);
  const sharesPositionPct = settings.risk.maxPositionPct;
  const vsStock = measured.length
    ? {
        measured: measured.length,
        stockRight: measured.filter((x) => x.move > 0).length,
        optionWon: measured.filter((x) => x.t.pnl > 0).length,
        stockRightButLost: measured.filter((x) => x.move > 0 && x.t.pnl <= 0).length,
        avgStockMovePct: round(avg(measured.map((x) => x.move))),
        sharesPnl: round(sum(measured.map((x) => ((x.t.equityAtEntry ?? startEquity) * sharesPositionPct) / 100 * (x.move / 100)))),
        sharesPositionPct,
      }
    : null;

  // ---- Claude: confidence spread, and what vetoed vs taken signals did next ----
  const confidences = rows.map((t) => t.reviewConfidence).filter((c): c is number => c != null);
  const moves = await signalOutcomes(reviewed).catch(() => new Map<number, number | null>());
  const claude = {
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    maxConfidence: confidences.length ? Math.max(...confidences) : null,
    outcomes: [
      outcome("Approved (ordered)", reviewed.filter((r) => r.status === "ordered"), moves),
      outcome("Vetoed by Claude", reviewed.filter((r) => r.status === "vetoed"), moves),
    ],
  };

  // ---- Blocked signals ----
  const blockedBy = new Map<string, { count: number; days: Set<string> }>();
  for (const r of blockedRows) {
    const reason = (r.reason ?? "unknown").replace(/ \(.*\)$/, "");
    const b = blockedBy.get(reason) ?? { count: 0, days: new Set<string>() };
    b.count++;
    b.days.add(r.day);
    blockedBy.set(reason, b);
  }
  const blocked = [...blockedBy.entries()]
    .map(([reason, b]) => ({ reason, count: b.count, days: b.days.size }))
    .sort((a, b) => b.count - a.count);

  return {
    since: rows[0] ? etDayOf(rows[0].openedAt) : null,
    summary, account, curve, groups, vsStock, claude, blocked,
    findings: findings({ rows, summary, groups, vsStock, claude, blocked }),
    trades: rows.map((t) => ({
      id: t.id, symbol: t.symbol, strategy: nameOf(t), instrument: t.instrument,
      openedAt: t.openedAt.toISOString(), closedAt: t.closedAt.toISOString(), pnl: round(t.pnl), pnlPct: round(t.pnlPct),
      stockMovePct: stockMove(t) == null ? null : round(stockMove(t)!), exitReason: t.exitReason,
      holdSessions: t.holdSessions, review: t.reviewDecision,
    })).reverse(),
  };
}

/** Plain-English takeaways, each backed by a number on the page. Deterministic: no model call. */
function findings(p: Pick<Performance, "summary" | "groups" | "vsStock" | "claude" | "blocked"> & { rows: Trade[] }): string[] {
  const out: string[] = [];
  const { rows, summary } = p;
  if (!rows.length) return out;
  const totalLoss = -sum(rows.filter((t) => t.pnl < 0).map((t) => t.pnl));

  // The single worst slice in each breakdown, when it holds a big share of the losses.
  for (const g of p.groups.slice(0, 3)) {
    const worst = [...g.rows].sort((a, b) => a.pnl - b.pnl)[0];
    if (!worst || worst.pnl >= 0 || g.rows.length < 2) continue;
    const share = totalLoss ? Math.round((-worst.pnl / totalLoss) * 100) : 0;
    if (share < 40) continue;
    const label = g.title === "By entry time (ET)" ? `Trades entered ${worst.key} ET` : g.title === "By exit reason" ? `Exits by ${worst.key}` : worst.key;
    out.push(`${label}: ${worst.trades} trades, ${signed(worst.pnl)}, ${worst.winRate}% winners (${share}% of all losing dollars).`);
  }

  const v = p.vsStock;
  if (v) {
    out.push(
      `The stock moved the way the rule bet on ${v.stockRight} of ${v.measured} trades (average move ${v.avgStockMovePct >= 0 ? "+" : ""}${v.avgStockMovePct}% in the rule's favour)` +
        (v.stockRight < v.measured / 2 ? ", so most losses start with the signal, before the options make them bigger." : ".") +
        (v.stockRightButLost ? ` ${v.stockRightButLost} more lost even though the stock went their way.` : ""),
    );
    if (rows.some((t) => t.instrument !== "shares"))
      out.push(
        `The same stock moves at the shares-mode size (${v.sharesPositionPct}% of equity) would have come to ${signed(v.sharesPnl)}, against ${signed(summary.netPnl)} with options. ` +
          `Leverage magnifies small moves against the trade, and every round trip pays the bid-ask spread.`,
      );
  }

  const stops = rows.filter((t) => /stop/.test(t.exitReason) && (t.holdSessions ?? 1) <= 1);
  if (stops.length >= 3)
    out.push(`${stops.length} trades hit a stop on the day they were opened, for ${signed(sum(stops.map((t) => t.pnl)))}: worth checking whether the stop is too tight for those names.`);

  const c = p.claude;
  if (c.minConfidence != null && c.maxConfidence! - c.minConfidence < 0.15)
    out.push(`Claude's confidence ranged only ${c.minConfidence}-${c.maxConfidence} across all trades, so it says little about which trades will work.`);
  const [taken, vetoed] = c.outcomes;
  if (taken.avgMovePct != null && vetoed.avgMovePct != null && vetoed.matured >= 3)
    out.push(
      `${HORIZON} sessions after the signal, vetoed stocks moved ${vetoed.avgMovePct >= 0 ? "+" : ""}${vetoed.avgMovePct}% in the rule's favour vs ${taken.avgMovePct >= 0 ? "+" : ""}${taken.avgMovePct}% for the approved ones: ` +
        (vetoed.avgMovePct < taken.avgMovePct ? "the vetoes are screening out weaker setups." : "the vetoes aren't adding value yet."),
    );

  const lossHalt = p.blocked.find((b) => b.reason === "daily_loss_limit");
  if (lossHalt) out.push(`The daily loss limit tripped on ${lossHalt.days} day${lossHalt.days === 1 ? "" : "s"}, blocking ${lossHalt.count} signals.`);

  if (rows.length < 30) out.push(`${rows.length} trades is a small sample: treat these as leads to check, not conclusions.`);
  return out;
}
