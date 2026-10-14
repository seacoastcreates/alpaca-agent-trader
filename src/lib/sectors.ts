// Sector lookup from Nasdaq's public stock screener (covers NYSE, NASDAQ and AMEX listings).
// It is unofficial, so results are stored with the universe and the previous map is kept if a fetch fails.

const SCREENER = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&download=true";

// The screener lists stocks only; pinned ETFs get a sector by hand.
const ETF_SECTORS: Record<string, string> = {
  SPY: "Broad market ETF", QQQ: "Broad market ETF", IWM: "Broad market ETF", DIA: "Broad market ETF",
  XLK: "Technology", XLF: "Finance", XLE: "Energy", XLV: "Health Care", XLI: "Industrials",
  XLY: "Consumer Discretionary", XLP: "Consumer Staples", XLU: "Utilities", XLB: "Basic Materials", XLRE: "Real Estate",
  SMH: "Technology", SOXX: "Technology",
};

export const UNCLASSIFIED = "Unclassified";

export async function fetchSectors(): Promise<Record<string, string>> {
  const res = await fetch(SCREENER, {
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
    headers: {
      // The endpoint rejects requests without a browser-like user agent.
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Nasdaq screener -> ${res.status}`);
  const body = (await res.json()) as { data?: { rows?: { symbol: string; sector: string }[] } };
  const rows = body.data?.rows ?? [];
  if (rows.length < 1000) throw new Error(`Nasdaq screener returned only ${rows.length} rows`);
  const out: Record<string, string> = {};
  for (const r of rows) if (r.sector) out[r.symbol.replace("/", ".")] = r.sector;
  return out;
}

// ETF sector by name, ordered so the most specific exposure wins (e.g. "Emerging Markets Bond" -> Bonds).
// Sector ETFs share the stock sectors so the per-sector cap counts SMH alongside NVDA.
const ETF_RULES: [RegExp, string][] = [
  [/\b(Bitcoin|Ethereum|Ether|Crypto|Solana)\b/i, "Crypto ETF"],
  [/\b(Bonds?|Treasury|T-Bill|Muni|Municipal|Corporate|High Yield|Aggregate|MBS|Senior Loan|Ultra-Short|Tax-Exempt)\b/i, "Bonds ETF"],
  [/\b(Gold|Silver|Copper|Platinum|Commodity|Commodities|Oil Fund)\b/i, "Commodities ETF"],
  [/Emerging|Brazil|Korea|Taiwan|Japan|India|China|Europe|EAFE|Developed|International|ex US|ACWI|World/i, "International ETF"],
  [/Semiconductor|Technology|Tech-|Software|Memory|Cybersecurity|Internet|Magnificent|Innovation|Genomic/i, "Technology"],
  [/Financial|Bank/i, "Finance"],
  [/Energy|Oil|Gas/i, "Energy"],
  [/Health|Biotech|Pharma/i, "Health Care"],
  [/Utilities/i, "Utilities"],
  [/Real Estate|REIT/i, "Real Estate"],
  [/Industrial|Jets|Aerospace|Defense|Transport/i, "Industrials"],
  [/Materials|Miners|Metals/i, "Basic Materials"],
  [/Staples/i, "Consumer Staples"],
  [/Discretionary|Retail|Homebuild|Home Construction/i, "Consumer Discretionary"],
  [/Communication/i, "Telecommunications"],
];

export function etfSector(name: string): string {
  return ETF_RULES.find(([re]) => re.test(name))?.[1] ?? "Broad market ETF";
}

export function sectorOf(symbol: string, sectors: Record<string, string>): string {
  return sectors[symbol] ?? ETF_SECTORS[symbol] ?? UNCLASSIFIED;
}
