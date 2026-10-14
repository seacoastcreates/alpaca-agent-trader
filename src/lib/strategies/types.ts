import type { Bar } from "../indicators";

export type Params = Record<string, number | boolean>;

export type ParamMeta = { label: string; min?: number; max?: number; step?: number };

export type EntryContext = {
  bars: Bar[];
  params: Params;
  /** Expected share of a full day's volume traded so far (1 for a completed bar); used to project partial-day volume. */
  sessionFraction: number;
};

export type ExitContext = {
  bars: Bar[];
  params: Params;
  entryPrice: number;
  highWater: number;
  /** Completed trading days since entry (0 on the entry day). */
  daysHeld: number;
};

export type Signal = { score: number; indicators: Record<string, number> };
export type ExitSignal = { reason: string; indicators: Record<string, number> };

export type Strategy = {
  id: string;
  name: string;
  /** Plain-English rules: shown in the UI and given to the Claude reviewer. */
  rules: (p: Params) => string;
  defaultParams: Params;
  paramMeta: Record<string, ParamMeta>;
  entry: (ctx: EntryContext) => Signal | null;
  /** Protective legs attached to the entry order so Alpaca enforces them even if a tick is missed. */
  bracket: (price: number, p: Params) => { stopPrice: number; takeProfitPrice?: number };
  exit: (ctx: ExitContext) => ExitSignal | null;
};

export const num = (p: Params, k: string) => Number(p[k]);
