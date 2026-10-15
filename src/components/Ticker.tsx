"use client";

import { useRef, useState } from "react";
import { STRATEGY_BY_ID } from "@/lib/strategies";

type Info = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  isEtf: boolean;
  company: {
    description: string | null; industry: string | null; sector: string | null; website: string | null;
    marketCap: string | null; fiftyTwoWeek: string | null; oneYearTarget: string | null; averageVolume: string | null;
    aum: string | null; expenseRatio: string | null; earnings: string | null;
  };
  quote: {
    price: number | null; changePct: number | null; sma50: number | null; sma200: number | null;
    rsi14: number | null; rsi2: number | null; high20: number | null; low20: number | null;
  };
  news: { headline: string; source: string; at: string; url: string | null }[];
  bot: {
    position: null | {
      instrument: string; contract: string | null; state: string; qty: number; strategyId: string; entryPrice: number | null;
      strike: number | null; expiration: string | null; stopPrice: number | null; takeProfitPrice: number | null; openedAt: string;
    };
    signals: { at: string; strategyId: string; kind: string; status: string; reason: string | null; decision: string | null }[];
    trades: { count: number; wins: number; totalPnl: number; last: { closedAt: string; strategyId: string; instrument: string; pnl: number; pnlPct: number; exitReason: string }[] };
  };
};

const usd = (n: number | null | undefined) =>
  n == null ? "–" : n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const stratName = (id: string) => STRATEGY_BY_ID[id]?.name ?? id;

/** A ticker that opens a popup with company info, indicators, news and the bot's history with it. */
export function Ticker({ symbol, className = "" }: { symbol: string; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    ref.current?.showModal();
    if (info) return;
    setError(null);
    try {
      const res = await fetch(`/api/company/${encodeURIComponent(symbol)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setInfo(await res.json());
    } catch (e) {
      setError(`Couldn't load ${symbol}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <>
      <button
        type="button" onClick={open}
        className={`font-medium underline decoration-muted decoration-dotted underline-offset-4 hover:text-accent hover:decoration-accent ${className}`}
      >
        {symbol}
      </button>
      <dialog
        ref={ref}
        // Clicking the backdrop (the dialog element itself, outside the panel) closes it; Esc works natively.
        onClick={(e) => e.target === ref.current && ref.current?.close()}
        className="m-auto w-[min(42rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel p-0 text-left text-ink shadow-xl backdrop:bg-black/40"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div className="min-w-0">
            <div className="text-lg font-semibold">
              {symbol}
              {info?.quote.price != null && (
                <span className="num ml-3 text-base font-medium">
                  {usd(info.quote.price)}
                  {info.quote.changePct != null && (
                    <span className={`ml-2 text-sm ${info.quote.changePct >= 0 ? "text-good" : "text-bad"}`}>
                      {info.quote.changePct >= 0 ? "+" : ""}{info.quote.changePct.toFixed(2)}%
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="truncate text-sm text-ink-2">
              {info ? [info.name, info.exchange, info.company.sector, info.company.industry].filter(Boolean).join(" · ") : "Loading…"}
            </div>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close"
            className="rounded px-2 py-1 text-lg leading-none text-muted hover:bg-ink/5 hover:text-ink">×</button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {error && <p className="text-bad">{error}</p>}
          {!info && !error && <p className="text-muted">Loading company info…</p>}
          {info && (
            <>
              {info.company.description && <p className="leading-relaxed text-ink-2">{info.company.description}</p>}

              <dl className="num grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                {[
                  ["Market cap", info.company.marketCap],
                  ["52-week range", info.company.fiftyTwoWeek],
                  [info.isEtf ? "Assets (AUM)" : "1-yr analyst target", info.isEtf ? info.company.aum : info.company.oneYearTarget],
                  ...(info.isEtf ? [["Expense ratio", info.company.expenseRatio]] : []),
                  ["Avg volume", info.company.averageVolume],
                  ["50-day avg", usd(info.quote.sma50)],
                  ["200-day avg", usd(info.quote.sma200)],
                  ["RSI(14) / RSI(2)", info.quote.rsi14 != null ? `${info.quote.rsi14} / ${info.quote.rsi2}` : null],
                  ["20-day high / low", info.quote.high20 != null ? `${usd(info.quote.high20)} / ${usd(info.quote.low20)}` : null],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <dt className="text-xs text-muted">{k}</dt>
                    <dd>{v ?? "–"}</dd>
                  </div>
                ))}
              </dl>
              {(info.company.earnings || info.company.website) && (
                <div className="space-y-1 text-xs">
                  {info.company.earnings && <p className="text-warn">{info.company.earnings}</p>}
                  {info.company.website && (
                    <a href={info.company.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                      {info.company.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                </div>
              )}

              <section>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">This bot</h3>
                {info.bot.position ? (
                  <p>
                    Holding {info.bot.position.qty}
                    {info.bot.position.contract
                      ? ` × $${info.bot.position.strike} ${info.bot.position.instrument} (${info.bot.position.expiration})`
                      : " shares"}{" "}
                    via {stratName(info.bot.position.strategyId)}, bought at {usd(info.bot.position.entryPrice)}
                    {info.bot.position.stopPrice != null && <> · stop {usd(info.bot.position.stopPrice)}</>}
                    {info.bot.position.takeProfitPrice != null && <> · target {usd(info.bot.position.takeProfitPrice)}</>}
                    <span className="text-muted"> ({info.bot.position.state})</span>
                  </p>
                ) : (
                  <p className="text-muted">No open position.</p>
                )}
                {info.bot.trades.count > 0 && (
                  <p className="mt-1">
                    {info.bot.trades.count} closed trades, {info.bot.trades.wins} winners, total{" "}
                    <span className={info.bot.trades.totalPnl >= 0 ? "text-good" : "text-bad"}>{usd(info.bot.trades.totalPnl)}</span>
                  </p>
                )}
                {info.bot.signals.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {info.bot.signals.map((s, i) => (
                      <li key={i} className="text-xs">
                        <span className="text-muted">{when(s.at)}</span> · {stratName(s.strategyId)} · {s.kind}{" "}
                        <span className={s.status === "ordered" ? "text-accent" : s.status === "vetoed" ? "text-bad" : "text-ink-2"}>{s.status}</span>
                        {s.reason && <div className="text-ink-2">{s.reason}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {info.news.length > 0 && (
                <section>
                  <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Recent news</h3>
                  <ul className="space-y-1.5">
                    {info.news.map((n, i) => (
                      <li key={i}>
                        {n.url ? (
                          <a href={n.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{n.headline}</a>
                        ) : n.headline}
                        <div className="text-xs text-muted">{n.source} · {when(n.at)}</div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </dialog>
    </>
  );
}
