import type { Bar } from "./indicators";

const TRADING_URL = process.env.ALPACA_TRADING_URL ?? "https://paper-api.alpaca.markets";
const DATA_URL = "https://data.alpaca.markets";
const FEED = process.env.ALPACA_DATA_FEED ?? "iex";

// Hard guard: this app only ever talks to the paper trading API.
function assertPaper() {
  if (!/paper-api\.alpaca\.markets/.test(TRADING_URL)) {
    throw new Error(`Refusing to trade: ALPACA_TRADING_URL (${TRADING_URL}) is not the paper API`);
  }
}

export class AlpacaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  if (base === TRADING_URL) assertPaper();
  const res = await fetch(base + path, {
    ...init,
    cache: "no-store",
    headers: {
      "APCA-API-KEY-ID": process.env.ALPACA_KEY_ID!,
      "APCA-API-SECRET-KEY": process.env.ALPACA_SECRET_KEY!,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new AlpacaError(res.status, `Alpaca ${init.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const trading = <T>(path: string, init?: RequestInit) => call<T>(TRADING_URL, path, init);
const data = <T>(path: string) => call<T>(DATA_URL, path);

// ---- Trading API ----

export type Clock = { timestamp: string; is_open: boolean; next_open: string; next_close: string };
export type Account = {
  equity: string; last_equity: string; cash: string; buying_power: string;
  status: string; trading_blocked: boolean;
};
export type Position = {
  symbol: string; qty: string; avg_entry_price: string; current_price: string;
  market_value: string; unrealized_pl: string; unrealized_plpc: string; change_today: string;
};
export type Order = {
  id: string; client_order_id: string; symbol: string; side: "buy" | "sell";
  qty: string; filled_qty: string; filled_avg_price: string | null; type: string;
  order_class: string; status: string; created_at: string; filled_at: string | null;
  stop_price: string | null; limit_price: string | null; legs?: Order[] | null;
};

export const getClock = () => trading<Clock>("/v2/clock");
export const getAccount = () => trading<Account>("/v2/account");
export const getPositions = () => trading<Position[]>("/v2/positions");

export function getOrders(params: { status: "open" | "closed" | "all"; after?: string; symbols?: string[] }) {
  const q = new URLSearchParams({ status: params.status, limit: "500", nested: "true", direction: "desc" });
  if (params.after) q.set("after", params.after);
  if (params.symbols?.length) q.set("symbols", params.symbols.join(","));
  return trading<Order[]>(`/v2/orders?${q}`);
}

export const getOrder = (id: string) => trading<Order>(`/v2/orders/${id}?nested=true`);
export const cancelOrder = (id: string) => trading<void>(`/v2/orders/${id}`, { method: "DELETE" });

export type NewOrder = {
  symbol: string; qty: string; side: "buy" | "sell"; type: "market";
  time_in_force: "day" | "gtc"; client_order_id: string;
  order_class?: "simple" | "bracket" | "oto";
  take_profit?: { limit_price: string };
  stop_loss?: { stop_price: string };
};
export const submitOrder = (o: NewOrder) => trading<Order>("/v2/orders", { method: "POST", body: JSON.stringify(o) });

export type PortfolioHistory = { timestamp: number[]; equity: (number | null)[]; profit_loss_pct: (number | null)[] };
export const getPortfolioHistory = (period = "3M") =>
  trading<PortfolioHistory>(`/v2/account/portfolio/history?period=${period}&timeframe=1D&intraday_reporting=market_hours`);

// ---- Market data ----

export type Asset = { symbol: string; exchange: string; tradable: boolean; status: string; name: string };
export const getAssets = () => trading<Asset[]>("/v2/assets?status=active&asset_class=us_equity");

const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Raw daily bars for many symbols between two dates (batched to keep URLs short, paginated). */
export async function fetchDailyBars(symbols: string[], start: string, end?: string): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  for (const batch of chunk(symbols, 200)) {
    let pageToken: string | undefined;
    do {
      const q = new URLSearchParams({
        symbols: batch.join(","), timeframe: "1Day", start, limit: "10000", adjustment: "all", feed: FEED,
      });
      if (end) q.set("end", end);
      if (pageToken) q.set("page_token", pageToken);
      const res = await data<{ bars: Record<string, Bar[]>; next_page_token: string | null }>(`/v2/stocks/bars?${q}`);
      for (const [sym, bars] of Object.entries(res.bars ?? {})) (out[sym] ??= []).push(...bars);
      pageToken = res.next_page_token ?? undefined;
    } while (pageToken);
  }
  return out;
}

// Completed daily bars don't change during the day, so keep them in memory per ET day.
// Warm serverless instances reuse this; a cold start reloads from Alpaca (a few seconds for ~500 symbols).
const history: { day: string; bars: Map<string, Bar[]> } = { day: "", bars: new Map() };

const etDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d);

/** Daily bars (split/dividend adjusted), keyed by symbol, with today's in-progress bar appended from snapshots. */
export async function getDailyBars(symbols: string[], days = 400): Promise<Record<string, Bar[]>> {
  if (!symbols.length) return {};
  const today = etDate();
  if (history.day !== today) {
    history.day = today;
    history.bars.clear();
  }
  const missing = symbols.filter((s) => !history.bars.has(s));
  if (missing.length) {
    const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const fetched = await fetchDailyBars(missing, start);
    for (const sym of missing) {
      history.bars.set(sym, (fetched[sym] ?? []).filter((b) => b.t.slice(0, 10) < today));
    }
  }

  const snaps = await getSnapshots(symbols);
  const out: Record<string, Bar[]> = {};
  for (const sym of symbols) {
    const bars = [...(history.bars.get(sym) ?? [])];
    const snap = snaps[sym];
    if (snap?.dailyBar) {
      // Use the latest trade as the "close" of the in-progress bar.
      const live: Bar = { ...snap.dailyBar, c: snap.latestTrade?.p ?? snap.dailyBar.c };
      const last = bars[bars.length - 1];
      if (last && last.t.slice(0, 10) === live.t.slice(0, 10)) bars[bars.length - 1] = live;
      else bars.push(live);
    }
    out[sym] = bars;
  }
  return out;
}

type Snapshot = { latestTrade?: { p: number; t: string }; dailyBar?: Bar; prevDailyBar?: Bar };
export async function getSnapshots(symbols: string[]): Promise<Record<string, Snapshot>> {
  const results = await Promise.all(
    chunk(symbols, 200).map((batch) =>
      data<Record<string, Snapshot>>(`/v2/stocks/snapshots?symbols=${batch.join(",")}&feed=${FEED}`),
    ),
  );
  return Object.assign({}, ...results);
}

/** Intraday bars for one symbol between two instants (paginated). */
export async function getIntradayBars(symbol: string, start: string, end: string, timeframe = "5Min"): Promise<Bar[]> {
  const out: Bar[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ timeframe, start, end, limit: "10000", feed: FEED });
    if (pageToken) q.set("page_token", pageToken);
    const res = await data<{ bars: Bar[] | null; next_page_token: string | null }>(`/v2/stocks/${symbol}/bars?${q}`);
    out.push(...(res.bars ?? []));
    pageToken = res.next_page_token ?? undefined;
  } while (pageToken);
  return out;
}

/** Price of a symbol at an instant: the open of the first 1-minute bar at or after it (null if none yet). */
export async function priceAt(symbol: string, at: Date): Promise<number | null> {
  const end = new Date(at.getTime() + 4 * 86400_000).toISOString(); // spans a weekend/holiday for overnight fills
  const q = new URLSearchParams({ timeframe: "1Min", start: at.toISOString(), end, limit: "1", feed: FEED });
  const res = await data<{ bars: Bar[] | null }>(`/v2/stocks/${symbol}/bars?${q}`);
  return res.bars?.[0]?.o ?? null;
}

export type NewsItem = { headline: string; summary: string; created_at: string; source: string };
export async function getNews(symbol: string, sinceDays = 4): Promise<NewsItem[]> {
  const start = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const res = await data<{ news: NewsItem[] }>(`/v1beta1/news?symbols=${symbol}&limit=10&start=${start}`);
  return res.news ?? [];
}
