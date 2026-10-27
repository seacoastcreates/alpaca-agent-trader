import type { Bar } from "../indicators";

export type Params = Record<string, number | boolean>;

export type ParamMeta = { label: string; min?: number; max?: number; step?: number };

export type EntryContext = {
  bars: Bar[];
  params: Params;
  /** Expected share of a full day's volume traded so far (1 for a completed bar); used to project partial-day volume. */
  sessionFraction: number;
  /** Today's completed regular-session bars at intervalMin(params) minutes; only set for strategies with intervalMin. */
  intraday?: Bar[];
  /** SPY daily bars (today's in-progress bar last during the session), for rules relative to the market. */
  benchmark?: Bar[];
};

export type ExitContext = {
  bars: Bar[];
  params: Params;
  entryPrice: number;
  /** Best underlying price since entry in the trade's direction: the high for bullish, the low for bearish. */
  highWater: number;
  /** Completed trading days since entry (0 on the entry day). */
  daysHeld: number;
};

export type Signal = { score: number; indicators: Record<string, number> };
export type ExitSignal = { reason: string; indicators: Record<string, number> };

export type Strategy = {
  id: string;
  name: string;
  /** Bullish signals buy shares or calls; bearish signals buy puts (options mode only). */
  direction: "bullish" | "bearish";
  /** Plain-English rules: shown in the UI and given to the Claude reviewer. */
  rules: (p: Params) => string;
  defaultParams: Params;
  /** Strategies that trade intraday candles (5 or 15 min) say which interval; the rest run on daily bars only. */
  intervalMin?: (p: Params) => number;
  /** Opening-bell rules may enter from the open, ahead of the global entry start time (they time themselves). */
  entryFromOpen?: boolean;
  /** Whether a newly added strategy starts enabled (default true). */
  defaultEnabled?: boolean;
  paramMeta: Record<string, ParamMeta>;
  entry: (ctx: EntryContext) => Signal | null;
  /**
   * Stop/target levels on the underlying. Bullish: stop below, target above (broker-held legs for shares).
   * Bearish: stop above, target below (checked each tick, since bearish trades are always puts).
   */
  bracket: (price: number, p: Params, indicators?: Record<string, number>) => { stopPrice: number; takeProfitPrice?: number };
  exit: (ctx: ExitContext) => ExitSignal | null;
};

export const num = (p: Params, k: string) => Number(p[k]);
