import { eq } from "drizzle-orm";
import { fetchDailyBars, getAssets } from "./alpaca";
import { db, universe } from "./db";
import { getSettings, type Settings } from "./settings";

const LOOKBACK_DAYS = 30; // trading days used for average dollar volume

// Alpaca has no ETF flag, so funds are recognised by name. Pinned symbols can still include any ETF.
const FUND_NAME = /\b(ETF|ETN|ETP)s?\b|Trust,? Series|\biShares\b|\bSPDR\b|ProShares|Direxion|Invesco QQQ|\bIndex Fund\b/i;

/**
 * Rank every active, tradable common-ticker stock on the chosen exchanges by average daily dollar volume
 * and keep the top N. Volume comes from the IEX feed (a slice of consolidated volume), which ranks
 * liquid names in roughly the same order.
 */
export async function computeUniverse(settings: Settings) {
  const { exchanges, size } = settings.universe;
  const assets = (await getAssets()).filter(
    // Plain tickers only: skips warrants, units, rights and preferreds (BRK.B-style dots, slashes, 5th-letter suffixes are rare enough to accept).
    (a) => a.tradable && exchanges.includes(a.exchange) && /^[A-Z]{1,5}$/.test(a.symbol) && !FUND_NAME.test(a.name),
  );
  const start = new Date(Date.now() - LOOKBACK_DAYS * 1.6 * 86400_000).toISOString().slice(0, 10);
  const bars = await fetchDailyBars(assets.map((a) => a.symbol), start);

  const ranked = Object.entries(bars)
    .map(([symbol, b]) => {
      const recent = b.slice(-LOOKBACK_DAYS);
      const last = recent.at(-1);
      if (recent.length < LOOKBACK_DAYS * 0.75 || !last || last.c < settings.risk.minPrice) return null;
      const dollarVolume = recent.reduce((sum, x) => sum + x.c * x.v, 0) / recent.length;
      return { symbol, dollarVolume };
    })
    .filter((x): x is { symbol: string; dollarVolume: number } => x !== null)
    .sort((a, b) => b.dollarVolume - a.dollarVolume);

  return {
    symbols: ranked.slice(0, size).map((r) => r.symbol),
    meta: { candidates: assets.length, ranked: ranked.length, exchanges, lookbackDays: LOOKBACK_DAYS },
  };
}

export async function refreshUniverse(opts: { force?: boolean } = {}) {
  const settings = await getSettings();
  const current = await getUniverse();
  const ageDays = current ? (Date.now() - current.computedAt.getTime()) / 86400_000 : Infinity;
  if (!opts.force && ageDays < settings.universe.refreshDays) return { refreshed: false, count: current!.symbols.length };

  const { symbols, meta } = await computeUniverse(settings);
  await db
    .insert(universe)
    .values({ id: 1, symbols, meta })
    .onConflictDoUpdate({ target: universe.id, set: { symbols, meta, computedAt: new Date() } });
  return { refreshed: true, count: symbols.length, meta };
}

export async function getUniverse() {
  return (await db.query.universe.findFirst({ where: eq(universe.id, 1) })) ?? null;
}

/** Everything the strategies scan: pinned watchlist + auto universe (deduped, pinned first). */
export async function scanList(settings: Settings): Promise<string[]> {
  if (!settings.universe.enabled) return settings.watchlist;
  const u = await getUniverse();
  return [...new Set([...settings.watchlist, ...(u?.symbols ?? [])])];
}
