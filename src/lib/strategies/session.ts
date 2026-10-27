import type { Bar } from "../indicators";

// Helpers for rules on today's intraday candles (regular session, completed candles only).

/** Prior session's close: daily bars carry today's in-progress bar last during the session. */
export function priorClose(daily: Bar[], intraday: Bar[]): number | null {
  const today = intraday[0]?.t.slice(0, 10);
  const last = daily.at(-1);
  if (!today || !last) return null;
  return (last.t.slice(0, 10) === today ? daily.at(-2) : last)?.c ?? null;
}

/** Session VWAP through each candle (typical price weighted by volume). */
export function vwapSeries(bars: Bar[]): number[] {
  let pv = 0, v = 0;
  return bars.map((b) => {
    pv += ((b.h + b.l + b.c) / 3) * b.v;
    v += b.v;
    return v ? pv / v : b.c;
  });
}

export const avgVolume = (bars: Bar[]) => (bars.length ? bars.reduce((s, b) => s + b.v, 0) / bars.length : 0);

/** Stop at a chart level, target a multiple of the risk; falls back to a percentage stop without the level. */
export function levelBracket(price: number, level: number | undefined, fallbackPct: number, targetR: number, bullish: boolean) {
  const stopPrice = level ?? price * (bullish ? 1 - fallbackPct / 100 : 1 + fallbackPct / 100);
  return { stopPrice, takeProfitPrice: price + (price - stopPrice) * targetR };
}
