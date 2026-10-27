import { round } from "../indicators";
import { levelBracket, priorClose } from "./session";
import { num, type ExitSignal, type Strategy } from "./types";

// Gap and go / gap fade, judged on the session's first candle. Calls when the first candle is green: after a gap up
// (go) or a gap down (fade). Puts are the mirror image. The stop is the first candle's far end; a fade targets the
// gap fill (the prior close), a go targets a multiple of the risk.
function gap(bullish: boolean): Strategy {
  return {
    id: bullish ? "gap_long" : "gap_short",
    direction: bullish ? "bullish" : "bearish",
    name: bullish ? "Gap and go / fade (calls)" : "Gap and go / fade (puts)",
    rules: (p) => {
      const fade = Boolean(p.fade);
      const gapDir = bullish !== fade ? "up" : "down";
      return (
        `${bullish ? "Buy calls" : "Buy puts"} after the stock gaps ${gapDir} ${p.minGapPct}-${p.maxGapPct}% from the prior close and ` +
        `the first ${num(p, "intervalMin") >= 15 ? 15 : 5}-minute candle closes ${bullish ? "green" : "red"} ` +
        `(${fade ? "fading the gap" : "following the gap"}). Stop at the first candle's ${bullish ? "low" : "high"} (skipped if ` +
        `more than ${p.maxRiskPct}% away), target ${fade ? "the prior close (gap fill)" : `${p.targetR}x the risk`}, or exit after ` +
        `${p.maxHoldDays} trading day(s).`
      );
    },
    defaultParams: { fade: false, intervalMin: 5, minGapPct: 2, maxGapPct: 10, maxRiskPct: 3, targetR: 2, maxHoldDays: 1 },
    paramMeta: {
      fade: { label: "Fade the gap instead of following it" },
      intervalMin: { label: "First candle (5 or 15 min)", min: 5, max: 15, step: 10 },
      minGapPct: { label: "Min gap %", min: 0.5, max: 20, step: 0.1 },
      maxGapPct: { label: "Max gap %", min: 1, max: 50, step: 0.5 },
      maxRiskPct: { label: "Max risk (% of price)", min: 0.2, max: 10, step: 0.1 },
      targetR: { label: "Target (x risk, gap and go)", min: 0.5, max: 10, step: 0.5 },
      maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 10, step: 1 },
    },
    intervalMin: (p) => (num(p, "intervalMin") >= 15 ? 15 : 5),
    entryFromOpen: true,
    defaultEnabled: false,
    entry({ bars: daily, intraday: bars, params: p }) {
      // Only while the first candle is the latest completed one.
      if (bars?.length !== 1) return null;
      const first = bars[0];
      const prev = priorClose(daily, bars);
      if (!prev) return null;
      const gapPct = (first.o / prev - 1) * 100;
      const fade = Boolean(p.fade);
      const wantUp = bullish !== fade;
      const size = wantUp ? gapPct : -gapPct;
      if (size < num(p, "minGapPct") || size > num(p, "maxGapPct")) return null;
      if (bullish ? first.c <= first.o : first.c >= first.o) return null;
      // A fade needs room left to the gap fill.
      if (fade && (bullish ? first.c >= prev : first.c <= prev)) return null;
      const stop = bullish ? first.l : first.h;
      const riskPct = (Math.abs(first.c - stop) / first.c) * 100;
      if (riskPct > num(p, "maxRiskPct")) return null;
      return {
        score: size,
        indicators: { price: first.c, gapPct: round(gapPct), priorClose: prev, stopLevel: stop, riskPct: round(riskPct) },
      };
    },
    bracket: (price, p, ind) => {
      const legs = levelBracket(price, ind?.stopLevel, num(p, "maxRiskPct"), num(p, "targetR"), bullish);
      return p.fade && ind?.priorClose ? { ...legs, takeProfitPrice: ind.priorClose } : legs;
    },
    exit: ({ bars, params: p, daysHeld }): ExitSignal | null =>
      daysHeld >= num(p, "maxHoldDays") ? { reason: "time_exit", indicators: { price: bars.at(-1)!.c, daysHeld } } : null,
  };
}

export const gapLong = gap(true);
export const gapShort = gap(false);
