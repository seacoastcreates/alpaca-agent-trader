import { round } from "../indicators";
import { priorClose, vwapSeries } from "./session";
import { num, type Strategy } from "./types";

// Relative strength vs SPY: calls on a stock up on the day while SPY is down (and above its VWAP); puts on a stock
// down while SPY is up (and below its VWAP).
function relativeStrength(bullish: boolean): Strategy {
  return {
    id: bullish ? "rs_leader" : "rs_laggard",
    direction: bullish ? "bullish" : "bearish",
    name: bullish ? "Relative strength vs SPY" : "Relative weakness vs SPY",
    rules: (p) =>
      `${bullish ? "Buy calls on a stock that is up" : "Buy puts on a stock that is down"} on the day while SPY is ` +
      `${bullish ? "down" : "up"} at least ${p.spyMovePct}%, beating SPY's move by at least ${p.minRsPct} points ` +
      `${bullish ? "the other way" : "to the downside"}, and trading ${bullish ? "above" : "below"} its session VWAP. ` +
      `Exit at a ${p.stopLossPct}% stop or ${p.targetPct}% target on the stock.`,
    defaultParams: { spyMovePct: 0.3, minRsPct: 1.5, stopLossPct: 1.5, targetPct: 3 },
    paramMeta: {
      spyMovePct: { label: "SPY move the other way (%)", min: 0, max: 5, step: 0.05 },
      minRsPct: { label: "Min gap vs SPY (points)", min: 0.2, max: 10, step: 0.1 },
      stopLossPct: { label: "Stock stop %", min: 0.2, max: 20, step: 0.1 },
      targetPct: { label: "Stock target %", min: 0.2, max: 50, step: 0.1 },
    },
    intervalMin: () => 5,
    defaultEnabled: false,
    entry({ bars, intraday, benchmark, params: p }) {
      if (!intraday?.length || !benchmark?.length) return null;
      const prev = priorClose(bars, intraday);
      const spyPrev = priorClose(benchmark, intraday);
      if (!prev || !spyPrev || benchmark.at(-1)!.t.slice(0, 10) !== intraday[0].t.slice(0, 10)) return null;
      const price = intraday.at(-1)!.c;
      const chg = (price / prev - 1) * 100;
      const spyChg = (benchmark.at(-1)!.c / spyPrev - 1) * 100;
      const vwap = vwapSeries(intraday).at(-1)!;
      const ok = bullish
        ? chg > 0 && spyChg <= -num(p, "spyMovePct") && chg - spyChg >= num(p, "minRsPct") && price > vwap
        : chg < 0 && spyChg >= num(p, "spyMovePct") && spyChg - chg >= num(p, "minRsPct") && price < vwap;
      if (!ok) return null;
      return {
        score: Math.abs(chg - spyChg),
        indicators: { price, changePct: round(chg), spyChangePct: round(spyChg), vwap: round(vwap, 3) },
      };
    },
    bracket: (price, p) => ({
      stopPrice: price * (bullish ? 1 - num(p, "stopLossPct") / 100 : 1 + num(p, "stopLossPct") / 100),
      takeProfitPrice: price * (bullish ? 1 + num(p, "targetPct") / 100 : 1 - num(p, "targetPct") / 100),
    }),
    exit: () => null,
  };
}

export const rsLeader = relativeStrength(true);
export const rsLaggard = relativeStrength(false);
