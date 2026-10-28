import { round } from "../indicators";
import { avgVolume, levelBracket } from "./session";
import { num, type Strategy } from "./types";

// Opening range breakout on 5-minute candles: the first rangeMin minutes set the range, the first candle to close
// beyond it is the signal. The stop is the other side of the range.
const CANDLE = 5;

function orb(bullish: boolean): Strategy {
  const side = bullish ? "high" : "low";
  return {
    id: bullish ? "orb_breakout" : "orb_breakdown",
    direction: bullish ? "bullish" : "bearish",
    name: bullish ? "Opening range breakout" : "Opening range breakdown",
    rules: (p) =>
      `${bullish ? "Buy calls" : "Buy puts"} when a 5-minute candle closes ${bullish ? "above" : "below"} the ${side} of the first ` +
      `${p.rangeMin} minutes of trading, the first close beyond it today, on volume at least ${p.volMult}x today's average candle, ` +
      `within ${p.lastEntryMin} minutes of the open. Skipped when the range is wider than ${p.maxRiskPct}% of price. Stop at the ` +
      `other side of the range, target ${p.targetR}x the risk.`,
    defaultParams: { rangeMin: 15, volMult: 1.2, lastEntryMin: 120, maxRiskPct: 2, targetR: 2 },
    paramMeta: {
      rangeMin: { label: "Opening range (minutes)", min: 5, max: 60, step: 5 },
      volMult: { label: "Volume multiple", min: 0, max: 5, step: 0.1 },
      lastEntryMin: { label: "Latest entry (minutes after open)", min: 10, max: 390, step: 5 },
      maxRiskPct: { label: "Max range (% of price)", min: 0.2, max: 10, step: 0.1 },
      targetR: { label: "Target (x risk)", min: 0.5, max: 10, step: 0.5 },
    },
    intervalMin: () => CANDLE,
    entryFromOpen: true,
    defaultEnabled: false,
    entry({ intraday: bars, params: p }) {
      const n = Math.round(num(p, "rangeMin") / CANDLE);
      if (!bars || bars.length <= n || bars.length * CANDLE > num(p, "lastEntryMin")) return null;
      const range = bars.slice(0, n);
      const hi = Math.max(...range.map((b) => b.h));
      const lo = Math.min(...range.map((b) => b.l));
      const cur = bars.at(-1)!;
      // First close beyond the range: every earlier candle closed inside it.
      const after = bars.slice(n, -1);
      const broke = bullish ? cur.c > hi && after.every((b) => b.c <= hi) : cur.c < lo && after.every((b) => b.c >= lo);
      if (!broke) return null;
      const riskPct = (Math.abs(cur.c - (bullish ? lo : hi)) / cur.c) * 100;
      const volRatio = cur.v / (avgVolume(bars.slice(0, -1)) || Infinity);
      if (riskPct > num(p, "maxRiskPct") || volRatio < num(p, "volMult")) return null;
      return {
        score: volRatio + (Math.abs(cur.c / (bullish ? hi : lo) - 1) * 100),
        indicators: { price: cur.c, rangeHigh: hi, rangeLow: lo, riskPct: round(riskPct), volRatio: round(volRatio) },
      };
    },
    bracket: (price, p, ind) =>
      levelBracket(price, bullish ? ind?.rangeLow : ind?.rangeHigh, num(p, "maxRiskPct"), num(p, "targetR"), bullish),
    exit: () => null,
  };
}

export const orbBreakout = orb(true);
export const orbBreakdown = orb(false);
