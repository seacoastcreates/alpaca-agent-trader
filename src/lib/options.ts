import * as alpaca from "./alpaca";
import { round } from "./indicators";

export type OptionsConfig = {
  premiumPct: number; // % of equity spent on premium per trade
  minDte: number;
  maxDte: number;
  targetDte: number;
  minDelta: number; // absolute delta, same for calls and puts
  maxDelta: number;
  targetDelta: number;
  minOpenInterest: number;
  maxSpreadPct: number; // (ask - bid) / mid, %
  premiumStopPct: number; // sell if the option loses this much
  premiumTargetPct: number; // sell if the option gains this much
  closeAtDte: number; // sell when this close to expiry
  entryTimeoutMin: number; // cancel an unfilled buy after this long
};

export type OptionType = "call" | "put";

export type OptionPick = {
  type: OptionType;
  contract: string;
  strike: number;
  expiration: string; // YYYY-MM-DD
  dte: number;
  bid: number;
  ask: number;
  mid: number; // (bid + ask) / 2: the entry limit is priced here
  delta: number; // signed: positive for calls, negative for puts
  iv: number | null;
  openInterest: number;
};

const DAY = 86400_000;
export const daysUntil = (date: string, from = new Date()) =>
  Math.round((Date.parse(`${date}T20:00:00Z`) - from.getTime()) / DAY);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** OCC symbol, e.g. AAPL261120C00335000 -> { expiration: 2026-11-20, type: C, strike: 335 }. */
export function parseOcc(occ: string) {
  const m = occ.match(/^([A-Z.]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
  if (!m) return null;
  return { root: m[1], expiration: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5], strike: Number(m[6]) / 1000 };
}

/**
 * Pick the call or put closest to the target delta (by absolute value, then target DTE) that passes the liquidity
 * filters and fits the budget. Returns a reason string when nothing qualifies, so the signal can be logged as blocked.
 */
export async function pickOption(
  underlying: string, type: OptionType, price: number, cfg: OptionsConfig, budget: number,
): Promise<OptionPick | string> {
  const now = new Date();
  // |delta| 0.5-0.8 lives roughly 0-25% in the money for 30-60 day options: below spot for calls, above for puts.
  const [lo, hi] = type === "call" ? [0.7, 1.05] : [0.95, 1.3];
  const filter = {
    type,
    expiration_date_gte: isoDate(new Date(now.getTime() + cfg.minDte * DAY)),
    expiration_date_lte: isoDate(new Date(now.getTime() + cfg.maxDte * DAY)),
    strike_price_gte: round(price * lo).toString(),
    strike_price_lte: round(price * hi).toString(),
  };
  const [chain, contracts] = await Promise.all([
    alpaca.getOptionChain(underlying, filter),
    alpaca.getOptionContracts({ underlying_symbols: underlying, ...filter }),
  ]);
  if (!Object.keys(chain).length) return "no_option_chain";
  const oi = new Map(contracts.map((c) => [c.symbol, Number(c.open_interest ?? 0)]));

  const picks: OptionPick[] = [];
  for (const [contract, snap] of Object.entries(chain)) {
    const occ = parseOcc(contract);
    const bid = snap.latestQuote?.bp ?? 0;
    const ask = snap.latestQuote?.ap ?? 0;
    const delta = snap.greeks?.delta;
    if (!occ || bid <= 0 || ask <= 0 || delta == null) continue;
    const mid = (bid + ask) / 2;
    if (((ask - bid) / mid) * 100 > cfg.maxSpreadPct) continue;
    if (Math.abs(delta) < cfg.minDelta || Math.abs(delta) > cfg.maxDelta) continue;
    const openInterest = oi.get(contract) ?? 0;
    if (openInterest < cfg.minOpenInterest) continue;
    picks.push({
      type,
      contract, strike: occ.strike, expiration: occ.expiration, dte: daysUntil(occ.expiration, now),
      bid, ask, mid, delta, iv: snap.impliedVolatility ?? null, openInterest,
    });
  }
  if (!picks.length) return `no_liquid_${type}`;
  // At least one contract must fit the premium budget (lower-delta strikes are cheaper).
  const affordable = picks.filter((p) => p.mid * 100 <= budget);
  if (!affordable.length) return "contract_too_expensive";
  const score = (p: OptionPick) => Math.abs(Math.abs(p.delta) - cfg.targetDelta) * 10 + Math.abs(p.dte - cfg.targetDte) / 30;
  return affordable.sort((a, b) => score(a) - score(b))[0];
}
