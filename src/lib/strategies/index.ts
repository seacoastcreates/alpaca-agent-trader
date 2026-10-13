import { breakout } from "./breakout";
import { rsiReversion } from "./rsi-reversion";
import { trendPullback } from "./trend-pullback";
import type { Strategy } from "./types";

export const STRATEGIES: Strategy[] = [trendPullback, rsiReversion, breakout];
export const STRATEGY_BY_ID = Object.fromEntries(STRATEGIES.map((s) => [s.id, s])) as Record<string, Strategy>;
export type { Strategy, Params } from "./types";
