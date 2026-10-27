import * as alpaca from "./alpaca";
import { round, type Bar } from "./indicators";
import { STRATEGY_BY_ID, type Params, type Strategy } from "./strategies";

// Replays the strategies' own entry/exit/bracket code over historical daily bars.
//
// Fill model (one decision per day, on completed bars):
// - Entries: the signal is checked on the day's close and fills at that close (the live bot enters up to 15:45 ET).
// - Stop / target: checked against the day's low/high, stop first when both are touched. A gap through a level
//   fills at the open instead of the level.
// - Strategy exit rules: checked on the close from the day after entry, filled at that close.
// - Bearish rules are simulated as a short of the stock (P&L = the stock's fall). The live bot trades them with
//   puts, whose P&L also depends on delta, time decay and IV, which free data can't replay.
// - Each strategy runs as its own account so the rules can be compared side by side.

/** Bars handed to the strategies each day: about what the live bot loads (400 calendar days). */
const WINDOW = 275;
/** Calendar days of history fetched before the test window so long SMAs are warm on day one. */
const WARMUP_DAYS = 420;
const BENCHMARK = "SPY";

export const PERIODS = { "6M": 182, "1Y": 365, "2Y": 730, "3Y": 1095 } as const;
export type Period = keyof typeof PERIODS;

export type SimOptions = {
  startEquity: number;
  positionPct: number; // % of equity per new position
  maxPositions: number; // open at once, per strategy
  minPrice: number;
  cooldownDays: number; // calendar days before re-entering a symbol
  slippageBps: number; // charged on entry and exit
};

export type BtTrade = {
  symbol: string;
  side: "long" | "short";
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  reason: string;
  daysHeld: number;
};

export type BtStats = {
  trades: number;
  winRate: number;
  avgTradePct: number;
  profitFactor: number | null;
  totalReturnPct: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  avgHoldDays: number;
  exposurePct: number; // average share of equity invested
};

export type BtStrategyResult = {
  id: string;
  name: string;
  direction: Strategy["direction"];
  stats: BtStats;
  exitReasons: Record<string, number>;
  trades: BtTrade[];
  openAtEnd: number;
};

type SimResult = BtStrategyResult & { equity: number[] };

export type BacktestResult = {
  start: string;
  end: string;
  symbols: number;
  options: SimOptions;
  benchmark: { symbol: string; totalReturnPct: number; maxDrawdownPct: number };
  /** One row per trading day: % return so far for the benchmark and each strategy id. */
  curve: ({ date: string } & Record<string, number | string>)[];
  strategies: BtStrategyResult[];
};

type Open = {
  symbol: string;
  entryIdx: number;
  entryDate: string;
  entryPrice: number;
  qty: number;
  stopPrice: number;
  takeProfitPrice?: number;
  highWater: number;
};

type Book = {
  def: Strategy;
  params: Params;
  realized: number;
  open: Map<string, Open>;
  lastExit: Map<string, string>;
  trades: BtTrade[];
  equity: number[];
  exposure: number[];
};

const day = (b: Bar) => b.t.slice(0, 10);
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400_000;

/** Pure simulation over pre-fetched bars. `dates` are the trading days in the test window, oldest first. */
export function simulate(
  strategies: { def: Strategy; params: Params }[],
  barsBySymbol: Record<string, Bar[]>,
  dates: string[],
  opts: SimOptions,
): SimResult[] {
  const symbols = Object.keys(barsBySymbol).filter((s) => barsBySymbol[s].length);
  const indexOf = new Map(symbols.map((s) => [s, new Map(barsBySymbol[s].map((b, i) => [day(b), i]))]));
  const slip = opts.slippageBps / 10_000;
  const books: Book[] = strategies.map(({ def, params }) => ({
    def, params, realized: 0, open: new Map(), lastExit: new Map(), trades: [], equity: [], exposure: [],
  }));

  const unrealized = (b: Book, closeOf: (s: string) => number | undefined) => {
    let pnl = 0;
    let invested = 0;
    for (const p of b.open.values()) {
      const c = closeOf(p.symbol) ?? p.entryPrice;
      pnl += (b.def.direction === "bearish" ? p.entryPrice - c : c - p.entryPrice) * p.qty;
      invested += p.qty * c;
    }
    return { pnl, invested };
  };

  for (const date of dates) {
    // Today's bar index for every symbol that traded, plus a shared trailing window per symbol.
    const today = new Map<string, number>();
    for (const s of symbols) {
      const i = indexOf.get(s)!.get(date);
      if (i != null) today.set(s, i);
    }
    const windows = new Map<string, Bar[]>();
    const windowOf = (s: string) => {
      let w = windows.get(s);
      if (!w) windows.set(s, (w = barsBySymbol[s].slice(Math.max(0, today.get(s)! - WINDOW + 1), today.get(s)! + 1)));
      return w;
    };
    const closeOf = (s: string) => {
      const i = today.get(s);
      return i == null ? undefined : barsBySymbol[s][i].c;
    };

    for (const b of books) {
      const bearish = b.def.direction === "bearish";
      const close = (p: Open, rawPrice: number, reason: string, idx: number) => {
        const price = rawPrice * (bearish ? 1 + slip : 1 - slip);
        const pnl = (bearish ? p.entryPrice - price : price - p.entryPrice) * p.qty;
        b.realized += pnl;
        b.open.delete(p.symbol);
        b.lastExit.set(p.symbol, date);
        b.trades.push({
          symbol: p.symbol, side: bearish ? "short" : "long", entryDate: p.entryDate, entryPrice: round(p.entryPrice),
          exitDate: date, exitPrice: round(price), qty: p.qty, pnl: round(pnl),
          pnlPct: round((pnl / (p.entryPrice * p.qty)) * 100), reason, daysHeld: idx - p.entryIdx,
        });
      };

      // ---- Exits ----
      for (const p of [...b.open.values()]) {
        const idx = today.get(p.symbol);
        if (idx == null) continue;
        const bar = barsBySymbol[p.symbol][idx];
        // Protective levels: stop first (conservative when the day touched both), gaps fill at the open.
        const hitStop = bearish ? bar.h >= p.stopPrice : bar.l <= p.stopPrice;
        const gapStop = bearish ? bar.o >= p.stopPrice : bar.o <= p.stopPrice;
        if (hitStop) {
          close(p, gapStop ? bar.o : p.stopPrice, "stop", idx);
          continue;
        }
        if (p.takeProfitPrice != null) {
          const hitTarget = bearish ? bar.l <= p.takeProfitPrice : bar.h >= p.takeProfitPrice;
          const gapTarget = bearish ? bar.o <= p.takeProfitPrice : bar.o >= p.takeProfitPrice;
          if (hitTarget) {
            close(p, gapTarget ? bar.o : p.takeProfitPrice, "target", idx);
            continue;
          }
        }
        p.highWater = bearish ? Math.min(p.highWater, bar.l) : Math.max(p.highWater, bar.h);
        const exit = b.def.exit({
          bars: windowOf(p.symbol), params: b.params, entryPrice: p.entryPrice, highWater: p.highWater,
          daysHeld: idx - p.entryIdx,
        });
        if (exit) close(p, bar.c, exit.reason, idx);
      }

      // ---- Entries: best scores first, into the free slots ----
      const free = opts.maxPositions - b.open.size;
      if (free > 0) {
        const candidates: { symbol: string; score: number; indicators: Record<string, number> }[] = [];
        for (const s of today.keys()) {
          if (b.open.has(s)) continue;
          const last = b.lastExit.get(s);
          if (last && daysBetween(last, date) < opts.cooldownDays) continue;
          const bars = windowOf(s);
          if (bars.at(-1)!.c < opts.minPrice) continue;
          const sig = b.def.entry({ bars, params: b.params, sessionFraction: 1 });
          if (sig) candidates.push({ symbol: s, score: sig.score, indicators: sig.indicators });
        }
        candidates.sort((a, c) => c.score - a.score);
        let { pnl, invested } = unrealized(b, closeOf);
        const equity = opts.startEquity + b.realized + pnl;
        for (const c of candidates.slice(0, free)) {
          const raw = closeOf(c.symbol)!;
          const price = raw * (bearish ? 1 - slip : 1 + slip);
          const notional = Math.min((equity * opts.positionPct) / 100, equity - invested);
          const qty = Math.floor(notional / price);
          if (qty < 1) continue;
          const legs = b.def.bracket(price, b.params, c.indicators);
          b.open.set(c.symbol, {
            symbol: c.symbol, entryIdx: today.get(c.symbol)!, entryDate: date, entryPrice: price, qty,
            stopPrice: legs.stopPrice, takeProfitPrice: legs.takeProfitPrice, highWater: price,
          });
          invested += qty * price;
          pnl += (bearish ? price - raw : raw - price) * qty; // the slippage just paid
        }
      }

      const { pnl, invested } = unrealized(b, closeOf);
      const equity = opts.startEquity + b.realized + pnl;
      b.equity.push(equity);
      b.exposure.push(equity > 0 ? invested / equity : 0);
    }
  }

  return books.map((b) => {
    const exitReasons: Record<string, number> = {};
    for (const t of b.trades) exitReasons[t.reason] = (exitReasons[t.reason] ?? 0) + 1;
    return {
      id: b.def.id, name: b.def.name, direction: b.def.direction, exitReasons, openAtEnd: b.open.size,
      trades: b.trades, equity: b.equity, stats: stats(b.trades, b.equity, b.exposure, opts.startEquity),
    };
  });
}

function maxDrawdownPct(equity: number[]) {
  let peak = -Infinity;
  let worst = 0;
  for (const e of equity) {
    peak = Math.max(peak, e);
    worst = Math.min(worst, e / peak - 1);
  }
  return round(worst * 100);
}

function stats(trades: BtTrade[], equity: number[], exposure: number[], start: number): BtStats {
  const wins = trades.filter((t) => t.pnl > 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = -trades.filter((t) => t.pnl < 0).reduce((a, t) => a + t.pnl, 0);
  const rets = equity.map((e, i) => e / (i ? equity[i - 1] : start) - 1);
  const mean = rets.reduce((a, r) => a + r, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length || 1));
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
  return {
    trades: trades.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100, 1) : 0,
    avgTradePct: round(avg(trades.map((t) => t.pnlPct))),
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss) : null,
    totalReturnPct: round(((equity.at(-1) ?? start) / start - 1) * 100),
    maxDrawdownPct: maxDrawdownPct(equity),
    sharpe: sd > 0 ? round((mean / sd) * Math.sqrt(252)) : null,
    avgHoldDays: round(avg(trades.map((t) => t.daysHeld)), 1),
    exposurePct: round(avg(exposure) * 100, 1),
  };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

// Re-running with different params shouldn't refetch. Keyed by the fetch window; warm instances reuse it.
let barCache: { key: string; bars: Record<string, Bar[]> } = { key: "", bars: {} };

/** Daily bars for many symbols, fetched in small parallel batches (one batch of 200 would page serially). */
async function loadBars(symbols: string[], start: string, end: string) {
  const key = `${start}:${end}`;
  if (barCache.key !== key) barCache = { key, bars: {} };
  const missing = symbols.filter((s) => !barCache.bars[s]);
  const batches = Array.from({ length: Math.ceil(missing.length / 10) }, (_, i) => missing.slice(i * 10, i * 10 + 10));
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        const got = await alpaca.fetchDailyBars(batch, start, end);
        for (const s of batch) barCache.bars[s] = got[s] ?? [];
      }
    }),
  );
  return Object.fromEntries(symbols.map((s) => [s, barCache.bars[s] ?? []]));
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export async function runBacktest(input: {
  strategies: { id: string; params: Params }[];
  symbols: string[];
  period: Period;
  options: SimOptions;
}): Promise<BacktestResult> {
  const defs = input.strategies.map((s) => {
    const def = STRATEGY_BY_ID[s.id];
    if (!def) throw new Error(`Unknown strategy ${s.id}`);
    return { def, params: { ...def.defaultParams, ...s.params } };
  });
  const now = Date.now();
  const end = isoDay(new Date(now - 86400_000)); // completed sessions only
  const start = isoDay(new Date(now - PERIODS[input.period] * 86400_000));
  const fetchStart = isoDay(new Date(Date.parse(start) - WARMUP_DAYS * 86400_000));
  const symbols = [...new Set([BENCHMARK, ...input.symbols])];
  const all = await loadBars(symbols, fetchStart, end);

  // The benchmark's sessions are the trading calendar.
  const spy = all[BENCHMARK].filter((b) => day(b) >= start);
  if (spy.length < 2) throw new Error("Not enough benchmark history for this period");
  const dates = spy.map(day);
  const universe = Object.fromEntries(Object.entries(all).filter(([s]) => input.symbols.includes(s)));
  const results = simulate(defs, universe, dates, input.options);

  // Equity curves as % return, one row per day.
  const curve = dates.map((date, i) => {
    const row: { date: string } & Record<string, number | string> = { date };
    row[BENCHMARK] = round((spy[i].c / spy[0].c - 1) * 100);
    for (const r of results) row[r.id] = round((r.equity[i] / input.options.startEquity - 1) * 100);
    return row;
  });
  return {
    start: dates[0],
    end: dates.at(-1)!,
    symbols: Object.values(universe).filter((b) => b.length).length,
    options: input.options,
    benchmark: {
      symbol: BENCHMARK,
      totalReturnPct: round((spy.at(-1)!.c / spy[0].c - 1) * 100),
      maxDrawdownPct: maxDrawdownPct(spy.map((b) => b.c)),
    },
    curve,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    strategies: results.map(({ equity, ...r }) => r),
  };
}
