import { round } from "../indicators";
import { avgVolume, levelBracket, vwapSeries } from "./session";
import { num, type ExitSignal, type Strategy } from "./types";

// VWAP reclaim (calls) / rejection (puts): after trading mostly on one side of the session VWAP, a candle closes
// back across it on volume. The stop sits just past the VWAP.
function vwap(bullish: boolean): Strategy {
  return {
    id: bullish ? "vwap_reclaim" : "vwap_rejection",
    direction: bullish ? "bullish" : "bearish",
    name: bullish ? "VWAP reclaim (intraday)" : "VWAP rejection (intraday)",
    rules: (p) =>
      `On ${num(p, "intervalMin") >= 15 ? 15 : 5}-minute candles, ${bullish ? "buy calls" : "buy puts"} when a candle closes back ` +
      `${bullish ? "above" : "below"} the session VWAP after at least ${p.setupPct}% of the prior ${p.setupBars} candles closed ` +
      `${bullish ? "below" : "above"} it, on volume at least ${p.volMult}x today's average candle. Stop ${p.stopPct}% ` +
      `${bullish ? "below" : "above"} the VWAP (skipped if that's more than ${p.maxRiskPct}% away), target ${p.targetR}x the risk, ` +
      `or exit after ${p.maxHoldDays} trading day(s).`,
    defaultParams: { intervalMin: 5, setupBars: 6, setupPct: 67, volMult: 1.2, stopPct: 0.3, maxRiskPct: 2, targetR: 2, maxHoldDays: 1 },
    paramMeta: {
      intervalMin: { label: "Candle interval (5 or 15 min)", min: 5, max: 15, step: 10 },
      setupBars: { label: "Setup (candles)", min: 2, max: 30, step: 1 },
      setupPct: { label: "Setup candles on the other side (%)", min: 50, max: 100, step: 1 },
      volMult: { label: "Volume multiple", min: 0, max: 5, step: 0.1 },
      stopPct: { label: "Stop past VWAP (%)", min: 0, max: 5, step: 0.05 },
      maxRiskPct: { label: "Max risk (% of price)", min: 0.2, max: 10, step: 0.1 },
      targetR: { label: "Target (x risk)", min: 0.5, max: 10, step: 0.5 },
      maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 10, step: 1 },
    },
    intervalMin: (p) => (num(p, "intervalMin") >= 15 ? 15 : 5),
    defaultEnabled: false,
    entry({ intraday: bars, params: p }) {
      const setupBars = num(p, "setupBars");
      if (!bars || bars.length < setupBars + 1) return null;
      const vw = vwapSeries(bars);
      const i = bars.length - 1;
      const cur = bars[i];
      const crossed = bullish ? cur.c > vw[i] && bars[i - 1].c < vw[i - 1] : cur.c < vw[i] && bars[i - 1].c > vw[i - 1];
      if (!crossed) return null;
      let otherSide = 0;
      for (let j = i - setupBars; j < i; j++) if (bullish ? bars[j].c < vw[j] : bars[j].c > vw[j]) otherSide++;
      const setup = (otherSide / setupBars) * 100;
      const volRatio = cur.v / (avgVolume(bars.slice(0, -1)) || Infinity);
      const stop = vw[i] * (bullish ? 1 - num(p, "stopPct") / 100 : 1 + num(p, "stopPct") / 100);
      const riskPct = (Math.abs(cur.c - stop) / cur.c) * 100;
      if (setup < num(p, "setupPct") || volRatio < num(p, "volMult") || riskPct > num(p, "maxRiskPct")) return null;
      return {
        score: volRatio + setup / 100,
        indicators: { price: cur.c, vwap: round(vw[i], 3), stopLevel: round(stop, 3), setupPct: round(setup), volRatio: round(volRatio) },
      };
    },
    bracket: (price, p, ind) => levelBracket(price, ind?.stopLevel, num(p, "maxRiskPct"), num(p, "targetR"), bullish),
    exit: ({ bars, params: p, daysHeld }): ExitSignal | null =>
      daysHeld >= num(p, "maxHoldDays") ? { reason: "time_exit", indicators: { price: bars.at(-1)!.c, daysHeld } } : null,
  };
}

export const vwapReclaim = vwap(true);
export const vwapRejection = vwap(false);
