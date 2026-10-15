import { priorAvgVolume, priorLow, rsi, sma, round } from "../indicators";
import { num, type ExitSignal, type Strategy } from "./types";

// Mirror images of the three bullish rules. They only trade in options mode, by buying puts.

export const trendRally: Strategy = {
  id: "trend_rally",
  direction: "bearish",
  name: "Downtrend + rally (puts)",
  rules: (p) =>
    `Buy puts on a stock in a downtrend (price below its ${p.trendLen}-day SMA) when RSI(${p.rsiLen}) rallies above ${p.rsiEntry}. ` +
    `Target a ${p.takeProfitPct}% drop in the stock, stop if it rises ${p.stopLossPct}%, exit after ${p.maxHoldDays} trading days` +
    (p.exitAboveTrend ? `, or when the stock closes back above the ${p.trendLen}-day SMA.` : "."),
  defaultParams: {
    trendLen: 50, rsiLen: 14, rsiEntry: 65, takeProfitPct: 6, stopLossPct: 3, maxHoldDays: 10, exitAboveTrend: true,
  },
  paramMeta: {
    trendLen: { label: "Trend SMA length", min: 10, max: 250, step: 1 },
    rsiLen: { label: "RSI length", min: 2, max: 30, step: 1 },
    rsiEntry: { label: "Buy puts when RSI above", min: 50, max: 95, step: 1 },
    takeProfitPct: { label: "Target: stock down %", min: 1, max: 50, step: 0.5 },
    stopLossPct: { label: "Stop: stock up %", min: 0.5, max: 25, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 60, step: 1 },
    exitAboveTrend: { label: "Exit on close above trend SMA" },
  },
  entry({ bars, params: p }) {
    const closes = bars.map((b) => b.c);
    const trend = sma(closes, num(p, "trendLen"));
    const r = rsi(closes, num(p, "rsiLen"));
    const price = closes.at(-1);
    if (trend == null || r == null || price == null) return null;
    if (price >= trend || r <= num(p, "rsiEntry")) return null;
    return {
      score: r - num(p, "rsiEntry"),
      indicators: { price, rsi: round(r), trendSma: round(trend), pctBelowTrend: round((1 - price / trend) * 100) },
    };
  },
  bracket: (price, p) => ({
    stopPrice: price * (1 + num(p, "stopLossPct") / 100),
    takeProfitPrice: price * (1 - num(p, "takeProfitPct") / 100),
  }),
  exit({ bars, params: p, daysHeld }): ExitSignal | null {
    const closes = bars.map((b) => b.c);
    const price = closes.at(-1)!;
    const trend = sma(closes, num(p, "trendLen"));
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    if (p.exitAboveTrend && trend != null && price > trend)
      return { reason: "above_trend", indicators: { price, trendSma: round(trend) } };
    return null;
  },
};

export const rsiOverbought: Strategy = {
  id: "rsi_overbought",
  direction: "bearish",
  name: "RSI-2 overbought (puts)",
  rules: (p) =>
    `Short-term mean reversion down: buy puts when RSI(${p.rsiLen}) rises above ${p.rsiEntry} while price is below its ${p.trendLen}-day SMA. ` +
    `Sell when price closes back below its ${p.exitSmaLen}-day SMA, after ${p.maxHoldDays} trading days, or if the stock rises ${p.stopLossPct}%.`,
  defaultParams: { rsiLen: 2, rsiEntry: 90, trendLen: 200, exitSmaLen: 5, stopLossPct: 5, maxHoldDays: 7 },
  paramMeta: {
    rsiLen: { label: "RSI length", min: 2, max: 14, step: 1 },
    rsiEntry: { label: "Buy puts when RSI above", min: 60, max: 99, step: 1 },
    trendLen: { label: "Trend filter SMA length", min: 20, max: 250, step: 1 },
    exitSmaLen: { label: "Exit SMA length", min: 2, max: 20, step: 1 },
    stopLossPct: { label: "Stop: stock up %", min: 0.5, max: 25, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 30, step: 1 },
  },
  entry({ bars, params: p }) {
    const closes = bars.map((b) => b.c);
    const trend = sma(closes, num(p, "trendLen"));
    const r = rsi(closes, num(p, "rsiLen"));
    const price = closes.at(-1);
    if (trend == null || r == null || price == null) return null;
    if (price >= trend || r <= num(p, "rsiEntry")) return null;
    return { score: r - num(p, "rsiEntry"), indicators: { price, rsi: round(r), trendSma: round(trend) } };
  },
  bracket: (price, p) => ({ stopPrice: price * (1 + num(p, "stopLossPct") / 100) }),
  exit({ bars, params: p, daysHeld }): ExitSignal | null {
    const closes = bars.map((b) => b.c);
    const price = closes.at(-1)!;
    const exitSma = sma(closes, num(p, "exitSmaLen"));
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    if (exitSma != null && price < exitSma) return { reason: "mean_reverted", indicators: { price, exitSma: round(exitSma) } };
    return null;
  },
};

export const breakdown: Strategy = {
  id: "breakdown",
  direction: "bearish",
  name: "Momentum breakdown (puts)",
  rules: (p) =>
    `Buy puts when price breaks below its prior ${p.lookback}-day low on volume at least ${p.volMult}x the ${p.lookback}-day average ` +
    `(today's volume projected from the share of the session elapsed). Exit on a ${p.trailPct}% rebound from the low since entry, ` +
    `a ${p.stopLossPct}% rise from entry, or after ${p.maxHoldDays} trading days.`,
  defaultParams: { lookback: 20, volMult: 1.5, trailPct: 8, stopLossPct: 7, maxHoldDays: 30 },
  paramMeta: {
    lookback: { label: "Breakdown lookback (days)", min: 5, max: 120, step: 1 },
    volMult: { label: "Volume multiple", min: 1, max: 5, step: 0.1 },
    trailPct: { label: "Trailing stop: rebound %", min: 1, max: 30, step: 0.5 },
    stopLossPct: { label: "Hard stop: stock up %", min: 1, max: 30, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 120, step: 1 },
  },
  entry({ bars, params: p, sessionFraction }) {
    const lookback = num(p, "lookback");
    const low = priorLow(bars, lookback);
    const avgVol = priorAvgVolume(bars, lookback);
    const last = bars.at(-1);
    if (low == null || avgVol == null || !last || avgVol === 0) return null;
    const volRatio = last.v / sessionFraction / avgVol;
    if (last.c >= low || volRatio < num(p, "volMult")) return null;
    const breakdownPct = (1 - last.c / low) * 100;
    return {
      score: breakdownPct + volRatio,
      indicators: { price: last.c, priorLow: round(low), breakdownPct: round(breakdownPct), volRatio: round(volRatio) },
    };
  },
  bracket: (price, p) => ({ stopPrice: price * (1 + num(p, "stopLossPct") / 100) }),
  exit({ bars, params: p, daysHeld, highWater: lowWater }): ExitSignal | null {
    const price = bars.at(-1)!.c;
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    const trailStop = lowWater * (1 + num(p, "trailPct") / 100);
    if (price >= trailStop)
      return { reason: "trailing_stop", indicators: { price, lowWater: round(lowWater), trailStop: round(trailStop) } };
    return null;
  },
};
