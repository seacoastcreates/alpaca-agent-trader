import { eq } from "drizzle-orm";
import { fetchDailyBars, getAssets } from "./alpaca";
import { db, universe } from "./db";
import { etfSector, fetchSectors } from "./sectors";
import { getSettings, type Settings } from "./settings";

const LOOKBACK_DAYS = 30; // trading days used for average dollar volume

// Alpaca has no ETF flag, so funds are recognised by name. Pinned symbols can still include any ETF.
export const FUND_NAME = /\b(ETF|ETN|ETP)s?\b|Trust,? Series|\biShares\b|\bSPDR\b|ProShares|Direxion|Invesco QQQ|\bIndex Fund\b/i;

// Uppercase words in fund names that are also stock tickers but don't mean "this fund tracks one stock".
const NOT_A_HOLDING = new Set([
  "ETF", "ETN", "SPDR", "MSCI", "USD", "USA", "ESG", "REIT", "TIPS", "MBS", "ARK", "KBW", "CSI", "FTSE", "STAR",
  "NEW", "QQQ", "SPY", "NYSE", "AI", "VIX", "ICE", "AMT", "FANG", "MLP",
]);
// Single-stock funds are leveraged, inverse or option-income products and say so in the name.
const SINGLE_STOCK_PRODUCT = /\b(\d(\.\d+)?x|Daily|Bull|Bear|Option Income|Covered Call|WeeklyPay|YieldBoost|Target)\b/i;

// The strategies only buy, so inverse funds (a bet on the market falling) and bond funds (too little movement for
// the targets and stops) are poor fits. "Short-Term" is a bond maturity, not an inverse fund.
const INVERSE_FUND = /\bBear\b|UltraShort|\bShort\b(?![- ]Term)|\bInverse\b/i;
const isTradableEtf = (name: string) => !INVERSE_FUND.test(name) && etfSector(name) !== "Bonds ETF";

/** e.g. "Direxion Daily TSLA Bull 2X ETF", "YieldMax NVDA Option Income Strategy ETF". */
function isSingleStockFund(name: string, stockTickers: Set<string>) {
  if (!SINGLE_STOCK_PRODUCT.test(name)) return false;
  return (name.match(/\b[A-Z]{2,5}\b/g) ?? []).some((t) => stockTickers.has(t) && !NOT_A_HOLDING.has(t));
}

type Ranked = { symbol: string; dollarVolume: number };

function rankByDollarVolume(bars: Record<string, { c: number; v: number }[]>, symbols: string[], minPrice: number): Ranked[] {
  return symbols
    .map((symbol) => {
      const recent = (bars[symbol] ?? []).slice(-LOOKBACK_DAYS);
      const last = recent.at(-1);
      if (recent.length < LOOKBACK_DAYS * 0.75 || !last || last.c < minPrice) return null;
      return { symbol, dollarVolume: recent.reduce((sum, x) => sum + x.c * x.v, 0) / recent.length };
    })
    .filter((x): x is Ranked => x !== null)
    .sort((a, b) => b.dollarVolume - a.dollarVolume);
}

/**
 * Rank every active, tradable common-ticker stock on the chosen exchanges by average daily dollar volume
 * and keep the top N. Volume comes from the IEX feed (a slice of consolidated volume), which ranks
 * liquid names in roughly the same order.
 */
export async function computeUniverse(settings: Settings) {
  const { exchanges, size, etfCount } = settings.universe;
  // Plain tickers only: skips warrants, units, rights and preferreds.
  const all = (await getAssets()).filter((a) => a.tradable && /^[A-Z]{1,5}$/.test(a.symbol));
  const stocks = all.filter((a) => !FUND_NAME.test(a.name));
  const stockTickers = new Set(stocks.map((a) => a.symbol));
  const stockCandidates = stocks.filter((a) => exchanges.includes(a.exchange));
  // ETFs list across exchanges (most on NYSE Arca and Cboe BZX), so no exchange filter here.
  const funds = all.filter((a) => FUND_NAME.test(a.name));
  const etfCandidates = funds.filter((a) => !isSingleStockFund(a.name, stockTickers) && isTradableEtf(a.name));

  const start = new Date(Date.now() - LOOKBACK_DAYS * 1.6 * 86400_000).toISOString().slice(0, 10);
  const symbols = [...stockCandidates, ...(etfCount > 0 ? etfCandidates : [])].map((a) => a.symbol);
  const bars = await fetchDailyBars(symbols, start);

  const minPrice = settings.risk.minPrice;
  const topStocks = rankByDollarVolume(bars, stockCandidates.map((a) => a.symbol), minPrice).slice(0, size);
  const topEtfs = rankByDollarVolume(bars, etfCandidates.map((a) => a.symbol), minPrice).slice(0, etfCount);
  const names = new Map(funds.map((a) => [a.symbol, a.name]));

  return {
    symbols: [...topStocks, ...topEtfs].map((r) => r.symbol),
    etfSectors: Object.fromEntries(topEtfs.map((r) => [r.symbol, etfSector(names.get(r.symbol) ?? "")])),
    meta: {
      candidates: stockCandidates.length,
      ranked: topStocks.length,
      exchanges,
      lookbackDays: LOOKBACK_DAYS,
      etfs: topEtfs.map((r) => r.symbol),
      fundsExcluded: funds.length - etfCandidates.length, // single-stock, inverse and bond funds
    },
  };
}

export async function refreshUniverse(opts: { force?: boolean } = {}) {
  const settings = await getSettings();
  const current = await getUniverse({ fresh: true });
  const ageDays = current ? (Date.now() - current.computedAt.getTime()) / 86400_000 : Infinity;
  if (!opts.force && ageDays < settings.universe.refreshDays) return { refreshed: false, count: current!.symbols.length };

  const [{ symbols, etfSectors, meta }, allSectors] = await Promise.all([
    computeUniverse(settings),
    fetchSectors().catch((err) => {
      console.error("sector fetch failed, keeping previous map:", err);
      return null;
    }),
  ]);
  // Keep only what we scan so the row stays small; fall back to the last good map.
  const sectors: Record<string, string> = {};
  for (const sym of [...settings.watchlist, ...symbols]) {
    const sector = etfSectors[sym] ?? allSectors?.[sym] ?? current?.sectors?.[sym];
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
