export type Bar = { t: string; o: number; h: number; l: number; c: number; v: number };

export function sma(values: number[], len: number): number | null {
  if (values.length < len) return null;
  let sum = 0;
  for (let i = values.length - len; i < values.length; i++) sum += values[i];
  return sum / len;
}

/** Wilder's RSI over the full series; returns the latest value. */
export function rsi(closes: number[], len: number): number | null {
  if (closes.length < len + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / len;
  let avgLoss = loss / len;
  for (let i = len + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (len - 1) + Math.max(d, 0)) / len;
    avgLoss = (avgLoss * (len - 1) + Math.max(-d, 0)) / len;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/** Highest high of the `len` bars before the last one. */
export function priorHigh(bars: Bar[], len: number): number | null {
  if (bars.length < len + 1) return null;
  return Math.max(...bars.slice(-len - 1, -1).map((b) => b.h));
}

/** Average volume of the `len` bars before the last one. */
export function priorAvgVolume(bars: Bar[], len: number): number | null {
  if (bars.length < len + 1) return null;
  const vols = bars.slice(-len - 1, -1).map((b) => b.v);
  return vols.reduce((a, b) => a + b, 0) / len;
}

export const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;
