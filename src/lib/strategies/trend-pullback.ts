import { rsi, sma, round } from "../indicators";
import { num, type ExitSignal, type Strategy } from "./types";

export const trendPullback: Strategy = {
  id: "trend_pullback",
  name: "Trend + pullback",
  rules: (p) =>
    `Buy a stock in an uptrend (price above its ${p.trendLen}-day SMA) when RSI(${p.rsiLen}) dips below ${p.rsiEntry}. ` +
    `Take profit at +${p.takeProfitPct}%, stop at -${p.stopLossPct}%, exit after ${p.maxHoldDays} trading days` +
    (p.exitBelowTrend ? `, or when price closes below the ${p.trendLen}-day SMA.` : "."),
  defaultParams: {
    trendLen: 50, rsiLen: 14, rsiEntry: 35, takeProfitPct: 6, stopLossPct: 3, maxHoldDays: 10, exitBelowTrend: true,
  },
  paramMeta: {
    trendLen: { label: "Trend SMA length", min: 10, max: 250, step: 1 },
    rsiLen: { label: "RSI length", min: 2, max: 30, step: 1 },
    rsiEntry: { label: "Buy when RSI below", min: 5, max: 50, step: 1 },
    takeProfitPct: { label: "Take profit %", min: 1, max: 50, step: 0.5 },
    stopLossPct: { label: "Stop loss %", min: 0.5, max: 25, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 60, step: 1 },
    exitBelowTrend: { label: "Exit on close below trend SMA" },
  },
  entry({ bars, params: p }) {
    const closes = bars.map((b) => b.c);
    const trend = sma(closes, num(p, "trendLen"));
    const r = rsi(closes, num(p, "rsiLen"));
    const price = closes.at(-1);
    if (trend == null || r == null || price == null) return null;
    if (price <= trend || r >= num(p, "rsiEntry")) return null;
    return {
      score: num(p, "rsiEntry") - r,
      indicators: { price, rsi: round(r), trendSma: round(trend), pctAboveTrend: round((price / trend - 1) * 100) },
    };
  },
  bracket: (price, p) => ({
    stopPrice: price * (1 - num(p, "stopLossPct") / 100),
    takeProfitPrice: price * (1 + num(p, "takeProfitPct") / 100),
  }),
  exit({ bars, params: p, daysHeld }): ExitSignal | null {
    const closes = bars.map((b) => b.c);
    const price = closes.at(-1)!;
    const trend = sma(closes, num(p, "trendLen"));
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    if (p.exitBelowTrend && trend != null && price < trend)
      return { reason: "below_trend", indicators: { price, trendSma: round(trend) } };
    return null;
  },
};
