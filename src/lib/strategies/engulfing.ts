import { round, type Bar } from "../indicators";
import { num, type Params, type Signal, type Strategy } from "./types";

const body = (b: Bar) => Math.abs(b.c - b.o);

/**
 * Engulfing candle on the last completed intraday bar: the candle's body opens beyond the prior candle's close and
 * closes beyond its open, after a move the other way, on above-average volume.
 */
function engulfing(bars: Bar[] | undefined, p: Params, bullish: boolean): Signal | null {
  const trendBars = num(p, "trendBars");
  const volBars = num(p, "volBars");
  if (!bars || bars.length < trendBars + 2) return null;
  const cur = bars.at(-1)!;
  const prev = bars.at(-2)!;
  const before = bars.at(-2 - trendBars)!;
  const up = (b: Bar) => b.c > b.o;
  const down = (b: Bar) => b.c < b.o;
  const pattern = bullish
    ? down(prev) && up(cur) && cur.o <= prev.c && cur.c >= prev.o && prev.c < before.c
    : up(prev) && down(cur) && cur.o >= prev.c && cur.c <= prev.o && prev.c > before.c;
  if (!pattern) return null;
  const bodyPct = (body(cur) / cur.c) * 100;
  const bodyRatio = body(prev) ? body(cur) / body(prev) : Infinity;
  if (bodyPct < num(p, "minBodyPct") || bodyRatio < num(p, "bodyMult")) return null;
  const prior = bars.slice(-1 - volBars, -1);
  const avgVol = prior.reduce((s, b) => s + b.v, 0) / (prior.length || 1);
  const volRatio = avgVol ? cur.v / avgVol : 0;
  if (volRatio < num(p, "volMult")) return null;
  const priorMovePct = (prev.c / before.c - 1) * 100;
  return {
    score: Math.min(bodyRatio, 5) + volRatio,
    indicators: {
      price: cur.c, intervalMin: num(p, "intervalMin"), bodyPct: round(bodyPct), bodyRatio: round(Math.min(bodyRatio, 99)),
      volRatio: round(volRatio), priorMovePct: round(priorMovePct), patternLow: Math.min(cur.l, prev.l), patternHigh: Math.max(cur.h, prev.h),
    },
  };
}

const params = { intervalMin: 5, trendBars: 3, bodyMult: 1.2, minBodyPct: 0.15, volBars: 12, volMult: 1.3, stopLossPct: 1, targetPct: 2 };
const paramMeta = {
  intervalMin: { label: "Candle interval (5 or 15 min)", min: 5, max: 15, step: 10 },
  trendBars: { label: "Prior move (candles)", min: 1, max: 20, step: 1 },
  bodyMult: { label: "Body vs prior candle (x)", min: 1, max: 5, step: 0.1 },
  minBodyPct: { label: "Min body (% of price)", min: 0, max: 5, step: 0.05 },
  volBars: { label: "Volume average (candles)", min: 3, max: 50, step: 1 },
  volMult: { label: "Volume multiple", min: 0, max: 5, step: 0.1 },
  stopLossPct: { label: "Stock stop %", min: 0.2, max: 20, step: 0.1 },
  targetPct: { label: "Stock target %", min: 0.2, max: 50, step: 0.1 },
};
const intervalMin = (p: Params) => (num(p, "intervalMin") >= 15 ? 15 : 5);
const rules = (side: string, p: Params) =>
  `On ${intervalMin(p)}-minute candles, ${side} when the last completed candle engulfs the one before it (body at least ` +
  `${p.bodyMult}x the prior body and ${p.minBodyPct}% of price) after a ${p.trendBars}-candle move the other way, on volume ` +
  `at least ${p.volMult}x the ${p.volBars}-candle average. Today's regular session only. Exit at a ${p.stopLossPct}% stop or a ` +
  `${p.targetPct}% target on the stock.`;

export const bullishEngulfing: Strategy = {
  id: "bullish_engulfing",
  direction: "bullish",
  name: "Bullish engulfing (intraday)",
  rules: (p) => rules("buy", p),
  defaultParams: params,
  paramMeta,
  intervalMin,
  defaultEnabled: false,
  entry: ({ intraday, params: p }) => engulfing(intraday, p, true),
  bracket: (price, p) => ({ stopPrice: price * (1 - num(p, "stopLossPct") / 100), takeProfitPrice: price * (1 + num(p, "targetPct") / 100) }),
  exit: () => null,
};

export const bearishEngulfing: Strategy = {
  id: "bearish_engulfing",
  direction: "bearish",
  name: "Bearish engulfing (intraday)",
  rules: (p) => rules("buy puts", p),
  defaultParams: params,
  paramMeta,
  intervalMin,
  defaultEnabled: false,
  entry: ({ intraday, params: p }) => engulfing(intraday, p, false),
  bracket: (price, p) => ({ stopPrice: price * (1 + num(p, "stopLossPct") / 100), takeProfitPrice: price * (1 - num(p, "targetPct") / 100) }),
  exit: () => null,
};
