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

/** Daily bars (split/dividend adjusted), keyed by symbol. Today's in-progress bar is appended from snapshots. */
export async function getDailyBars(symbols: string[], days = 400): Promise<Record<string, Bar[]>> {
  const out: Record<string, Bar[]> = {};
  if (!symbols.length) return out;
  const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      symbols: symbols.join(","), timeframe: "1Day", start, limit: "10000", adjustment: "all", feed: FEED,
    });
    if (pageToken) q.set("page_token", pageToken);
    const res = await data<{ bars: Record<string, Bar[]>; next_page_token: string | null }>(`/v2/stocks/bars?${q}`);
    for (const [sym, bars] of Object.entries(res.bars ?? {})) (out[sym] ??= []).push(...bars);
    pageToken = res.next_page_token ?? undefined;
  } while (pageToken);

  const snaps = await getSnapshots(symbols);
  for (const sym of symbols) {
    const snap = snaps[sym];
    const bars = (out[sym] ??= []);
    if (!snap?.dailyBar) continue;
    const today = snap.dailyBar;
    const last = bars[bars.length - 1];
    // Use the latest trade as the "close" of the in-progress bar.
    const live: Bar = { ...today, c: snap.latestTrade?.p ?? today.c };
    if (last && last.t.slice(0, 10) === today.t.slice(0, 10)) bars[bars.length - 1] = live;
    else bars.push(live);
  }
  return out;
}

type Snapshot = { latestTrade?: { p: number; t: string }; dailyBar?: Bar; prevDailyBar?: Bar };
export function getSnapshots(symbols: string[]) {
  return data<Record<string, Snapshot>>(`/v2/stocks/snapshots?symbols=${symbols.join(",")}&feed=${FEED}`);
}

export type NewsItem = { headline: string; summary: string; created_at: string; source: string };
export async function getNews(symbol: string, sinceDays = 4): Promise<NewsItem[]> {
  const start = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const res = await data<{ news: NewsItem[] }>(`/v1beta1/news?symbols=${symbol}&limit=10&start=${start}`);
  return res.news ?? [];
}
