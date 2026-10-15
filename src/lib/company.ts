// Company profile and summary from Nasdaq's public quote API (unofficial, best effort, cached in memory).

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const TTL = 6 * 3600_000;
const cache = new Map<string, { at: number; value: unknown }>();

async function nasdaq<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL) return hit.value as T;
  try {
    const res = await fetch(`https://api.nasdaq.com/api${path}`, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const value = ((await res.json()) as { data?: T }).data ?? null;
    cache.set(path, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

type Field = { value: string | number | null };
const val = (f?: Field) => (f?.value == null || f.value === "N/A" || f.value === "" ? null : String(f.value));

export type CompanyInfo = {
  description: string | null;
  industry: string | null;
  sector: string | null;
  website: string | null;
  marketCap: string | null;
  fiftyTwoWeek: string | null;
  oneYearTarget: string | null;
  averageVolume: string | null;
  aum: string | null; // ETFs
  expenseRatio: string | null; // ETFs
  earnings: string | null;
};

export async function companyInfo(symbol: string, isEtf: boolean): Promise<CompanyInfo> {
  const sym = encodeURIComponent(symbol.replace(".", "/"));
  const [profile, summary, earnings] = await Promise.all([
    isEtf ? null : nasdaq<Record<string, Field>>(`/company/${sym}/company-profile`),
    nasdaq<{ summaryData?: Record<string, Field> }>(`/quote/${sym}/summary?assetclass=${isEtf ? "etf" : "stocks"}`),
    isEtf ? null : nasdaq<{ announcement?: string; reportText?: string }>(`/analyst/${sym}/earnings-date`),
  ]);
  const sd = summary?.summaryData ?? {};
  const report = earnings?.reportText ?? "";
  const cap = val(sd.MarketCap);
  return {
    description: val(profile?.CompanyDescription),
    industry: val(profile?.Industry) ?? val(sd.Industry),
    sector: val(profile?.Sector) ?? val(sd.Sector),
    website: val(profile?.CompanyUrl),
    marketCap: cap ? formatBig(Number(cap.replace(/,/g, ""))) : null,
    fiftyTwoWeek: val(sd.FiftTwoWeekHighLow),
    oneYearTarget: val(sd.OneYrTarget),
    averageVolume: val(sd.AverageVolume) ?? val(sd.FiftyDayAvgDailyVol),
    aum: val(sd.AUM) ? formatBig(Number(val(sd.AUM)!.replace(/,/g, "")) * 1000) : null, // reported in thousands
    expenseRatio: val(sd.ExpenseRatio),
    // The vendor often has no date; only show real announcements.
    earnings: report && !/hasn't provided|not available/i.test(report) ? report : null,
  };
}

function formatBig(n: number) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const units: [number, string][] = [[1e12, "T"], [1e9, "B"], [1e6, "M"]];
  for (const [u, s] of units) if (n >= u) return `$${(n / u).toFixed(n >= 100 * u ? 0 : 1)}${s}`;
  return `$${n.toLocaleString("en-US")}`;
}
