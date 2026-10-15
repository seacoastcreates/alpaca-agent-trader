import { priorAvgVolume, priorHigh, round } from "../indicators";
import { num, type ExitSignal, type Strategy } from "./types";

export const breakout: Strategy = {
  id: "breakout",
  direction: "bullish",
  name: "Momentum breakout",
  rules: (p) =>
    `Buy when price breaks above its prior ${p.lookback}-day high on volume at least ${p.volMult}x the ${p.lookback}-day average ` +
    `(today's volume is projected from the share of the session elapsed). Exit on a ${p.trailPct}% trailing stop from the high since entry, ` +
    `a -${p.stopLossPct}% hard stop, or after ${p.maxHoldDays} trading days.`,
  defaultParams: { lookback: 20, volMult: 1.5, trailPct: 8, stopLossPct: 7, maxHoldDays: 30 },
  paramMeta: {
    lookback: { label: "Breakout lookback (days)", min: 5, max: 120, step: 1 },
    volMult: { label: "Volume multiple", min: 1, max: 5, step: 0.1 },
    trailPct: { label: "Trailing stop %", min: 1, max: 30, step: 0.5 },
    stopLossPct: { label: "Hard stop %", min: 1, max: 30, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 120, step: 1 },
  },
  entry({ bars, params: p, sessionFraction }) {
    const lookback = num(p, "lookback");
    const high = priorHigh(bars, lookback);
    const avgVol = priorAvgVolume(bars, lookback);
    const last = bars.at(-1);
    if (high == null || avgVol == null || !last || avgVol === 0) return null;
    const projectedVol = last.v / sessionFraction;
    const volRatio = projectedVol / avgVol;
    if (last.c <= high || volRatio < num(p, "volMult")) return null;
    const breakoutPct = (last.c / high - 1) * 100;
    return {
      score: breakoutPct + volRatio,
      indicators: { price: last.c, priorHigh: round(high), breakoutPct: round(breakoutPct), volRatio: round(volRatio) },
    };
  },
  bracket: (price, p) => ({ stopPrice: price * (1 - num(p, "stopLossPct") / 100) }),
  exit({ bars, params: p, daysHeld, highWater }): ExitSignal | null {
    const price = bars.at(-1)!.c;
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    const trailStop = highWater * (1 - num(p, "trailPct") / 100);
    if (price <= trailStop)
      return { reason: "trailing_stop", indicators: { price, highWater: round(highWater), trailStop: round(trailStop) } };
    return null;
  },
};
