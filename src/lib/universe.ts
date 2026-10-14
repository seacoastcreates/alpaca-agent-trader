import { eq } from "drizzle-orm";
import { fetchDailyBars, getAssets } from "./alpaca";
import { db, universe } from "./db";
import { fetchSectors } from "./sectors";
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
  const current = await getUniverse({ fresh: true });
  const ageDays = current ? (Date.now() - current.computedAt.getTime()) / 86400_000 : Infinity;
  if (!opts.force && ageDays < settings.universe.refreshDays) return { refreshed: false, count: current!.symbols.length };

  const [{ symbols, meta }, allSectors] = await Promise.all([
    computeUniverse(settings),
    fetchSectors().catch((err) => {
      console.error("sector fetch failed, keeping previous map:", err);
      return null;
    }),
  ]);
  // Keep only what we scan so the row stays small; fall back to the last good map.
  const sectors: Record<string, string> = {};
  for (const sym of [...settings.watchlist, ...symbols]) {
    const sector = allSectors?.[sym] ?? current?.sectors?.[sym];
    if (sector) sectors[sym] = sector;
  }
  await db
    .insert(universe)
    .values({ id: 1, symbols, sectors, meta })
    .onConflictDoUpdate({ target: universe.id, set: { symbols, sectors, meta, computedAt: new Date() } });
  cache = null;
  return { refreshed: true, count: symbols.length, sectorsFetched: !!allSectors, meta };
}

type UniverseRow = typeof universe.$inferSelect;
let cache: { row: UniverseRow | null; at: number } | null = null;

/** The stored universe; cached in memory for 10 minutes since it changes weekly and ticks run every minute. */
export async function getUniverse(opts: { fresh?: boolean } = {}): Promise<UniverseRow | null> {
  if (!opts.fresh && cache && Date.now() - cache.at < 10 * 60_000) return cache.row;
  const row = (await db.query.universe.findFirst({ where: eq(universe.id, 1) })) ?? null;
  cache = { row, at: Date.now() };
  return row;
}

/** Everything the strategies scan (pinned watchlist + auto universe, deduped, pinned first) and their sectors. */
export async function scanList(settings: Settings): Promise<{ symbols: string[]; sectors: Record<string, string> }> {
  const u = await getUniverse();
  const symbols = settings.universe.enabled
    ? [...new Set([...settings.watchlist, ...(u?.symbols ?? [])])]
    : settings.watchlist;
  return { symbols, sectors: u?.sectors ?? {} };
}
