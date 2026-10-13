import { rsi, sma, round } from "../indicators";
import { num, type ExitSignal, type Strategy } from "./types";

export const rsiReversion: Strategy = {
  id: "rsi_reversion",
  name: "RSI-2 mean reversion",
  rules: (p) =>
    `Short-term mean reversion: buy when RSI(${p.rsiLen}) drops below ${p.rsiEntry} while price is above its ${p.trendLen}-day SMA. ` +
    `Sell when price closes back above its ${p.exitSmaLen}-day SMA, after ${p.maxHoldDays} trading days, or on a -${p.stopLossPct}% stop.`,
  defaultParams: { rsiLen: 2, rsiEntry: 10, trendLen: 200, exitSmaLen: 5, stopLossPct: 5, maxHoldDays: 7 },
  paramMeta: {
    rsiLen: { label: "RSI length", min: 2, max: 14, step: 1 },
    rsiEntry: { label: "Buy when RSI below", min: 1, max: 40, step: 1 },
    trendLen: { label: "Trend filter SMA length", min: 20, max: 250, step: 1 },
    exitSmaLen: { label: "Exit SMA length", min: 2, max: 20, step: 1 },
    stopLossPct: { label: "Stop loss %", min: 0.5, max: 25, step: 0.5 },
    maxHoldDays: { label: "Max hold (trading days)", min: 1, max: 30, step: 1 },
  },
  entry({ bars, params: p }) {
    const closes = bars.map((b) => b.c);
    const trend = sma(closes, num(p, "trendLen"));
    const r = rsi(closes, num(p, "rsiLen"));
    const price = closes.at(-1);
    if (trend == null || r == null || price == null) return null;
    if (price <= trend || r >= num(p, "rsiEntry")) return null;
    return { score: num(p, "rsiEntry") - r, indicators: { price, rsi: round(r), trendSma: round(trend) } };
  },
  bracket: (price, p) => ({ stopPrice: price * (1 - num(p, "stopLossPct") / 100) }),
  exit({ bars, params: p, daysHeld }): ExitSignal | null {
    const closes = bars.map((b) => b.c);
    const price = closes.at(-1)!;
    const exitSma = sma(closes, num(p, "exitSmaLen"));
    if (daysHeld >= num(p, "maxHoldDays")) return { reason: "time_exit", indicators: { price, daysHeld } };
    if (exitSma != null && price > exitSma) return { reason: "mean_reverted", indicators: { price, exitSma: round(exitSma) } };
    return null;
  },
};
