import { breakdown, rsiOverbought, trendRally } from "./bearish";
import { breakout } from "./breakout";
import { bearishEngulfing, bullishEngulfing } from "./engulfing";
import { gapLong, gapShort } from "./gap";
import { insideDayBreakdown, insideDayBreakout } from "./inside-day";
import { orbBreakdown, orbBreakout } from "./orb";
import { rsLaggard, rsLeader } from "./relative-strength";
import { rsiReversion } from "./rsi-reversion";
import { trendPullback } from "./trend-pullback";
import type { Strategy } from "./types";
import { vwapReclaim, vwapRejection } from "./vwap";

export const STRATEGIES: Strategy[] = [
  trendPullback, rsiReversion, breakout, trendRally, rsiOverbought, breakdown,
  insideDayBreakout, insideDayBreakdown,
  bullishEngulfing, bearishEngulfing, orbBreakout, orbBreakdown, vwapReclaim, vwapRejection,
  gapLong, gapShort, rsLeader, rsLaggard,
];
export const STRATEGY_BY_ID = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<string, Strategy>;
export type { Strategy, Params } from "./types";
