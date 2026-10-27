import { priorAvgVolume, round } from "../indicators";
import { levelBracket } from "./session";
import { num, type ExitSignal, type Strategy } from "./types";

// Inside day: yesterday's range sat inside the day before's. Trade today's break of yesterday's high (calls) or low
// (puts); the stop is the other side of yesterday's range.
function insideDay(bullish: boolean): Strategy {
  return {
    id: bullish ? "inside_day_breakout" : "inside_day_breakdown",
    direction: bullish ? "bullish" : "bearish",
    name: bullish ? "Inside day breakout" : "Inside day breakdown",
    rules: (p) =>
      `When yesterday's high and low were inside the day before's range, ${bullish ? "buy" : "buy puts"} once today's price ` +
      `breaks ${bullish ? "above yesterday's high" : "below yesterday's low"} on volume projected at least ${p.volMult}x the ` +
      `20-day average. Stop at yesterday's ${bullish ? "low" : "high"} (skipped if more than ${p.maxRiskPct}% away), target ` +
      `${p.targetR}x the risk, or exit after ${p.maxHoldDays} trading days.`,
    defaultParams: { volMult: 1, maxRiskPct: 5, targetR: 2, maxHoldDays: 5 },
    paramMeta: {
      volMult: { label: "Volume multiple", min: 0, max: 5, step: 0.1 },
      maxRiskPct: { label: "Max risk (% of price)", min: 0.5, max: 20, step: 0.5 },
      targetR: { label: "Target (x risk)", min: 0.5, max: 10, step: 0.5 },
      maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 30, step: 1 },
    },
    defaultEnabled: false,
    entry({ bars, params: p, sessionFraction }) {
      if (bars.length < 23) return null;
      const [mother, inside, today] = bars.slice(-3);
      if (inside.h > mother.h || inside.l < mother.l) return null;
      const broke = bullish ? today.c > inside.h : today.c < inside.l;
      if (!broke) return null;
      const avgVol = priorAvgVolume(bars, 20);
      const volRatio = avgVol ? today.v / sessionFraction / avgVol : 0;
      const stop = bullish ? inside.l : inside.h;
      const riskPct = (Math.abs(today.c - stop) / today.c) * 100;
      if (volRatio < num(p, "volMult") || riskPct > num(p, "maxRiskPct")) return null;
      return {
        score: volRatio + (mother.h - mother.l) / (inside.h - inside.l || Infinity),
        indicators: { price: today.c, insideHigh: inside.h, insideLow: inside.l, riskPct: round(riskPct), volRatio: round(volRatio) },
      };
    },
    bracket: (price, p, ind) =>
      levelBracket(price, bullish ? ind?.insideLow : ind?.insideHigh, num(p, "maxRiskPct"), num(p, "targetR"), bullish),
    exit: ({ bars, params: p, daysHeld }): ExitSignal | null =>
      daysHeld >= num(p, "maxHoldDays") ? { reason: "time_exit", indicators: { price: bars.at(-1)!.c, daysHeld } } : null,
  };
}

export const insideDayBreakout = insideDay(true);
export const insideDayBreakdown = insideDay(false);
