"use client";

import { useEffect, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { BacktestResult, Period } from "@/lib/backtest";
import { Badge, Card, Table, pct, td, usd } from "./ui";

type StrategyOption = { id: string; name: string; direction: "bullish" | "bearish"; enabled: boolean };

const PERIOD_LABELS: Record<Period, string> = { "6M": "6 months", "1Y": "1 year", "2Y": "2 years", "3Y": "3 years" };
// Distinct in both light and dark themes; the benchmark is a dashed muted line.
const COLORS = ["#2f7ed8", "#d9822b", "#16a34a", "#c2410c", "#8b5cf6", "#0e9fa6"];
const signed = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "");
const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", year: "2-digit" });

export function BacktestRunner({ strategies, defaults, watchlistCount, fullCount }: {
  strategies: StrategyOption[];
  defaults: { positionPct: number; maxPositions: number };
  watchlistCount: number;
  fullCount: number;
}) {
  const [selected, setSelected] = useState(() => strategies.map((s) => s.id));
  const [period, setPeriod] = useState<Period>("3Y");
  const [universe, setUniverse] = useState<"watchlist" | "full">("watchlist");
  const [positionPct, setPositionPct] = useState(defaults.positionPct);
  const [maxPositions, setMaxPositions] = useState(defaults.maxPositions);
  const [slippageBps, setSlippageBps] = useState(5);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [tradeFilter, setTradeFilter] = useState("all");

  async function run() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strategies: selected, period, universe, positionPct, maxPositions, slippageBps }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setResult(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  // Show results straight away with the defaults (watchlist, 3 years: a second or two).
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colorOf = (id: string) => COLORS[strategies.findIndex((s) => s.id === id) % COLORS.length];
  const trades = (result?.strategies ?? [])
    .filter((s) => tradeFilter === "all" || s.id === tradeFilter)
    .flatMap((s) => s.trades.map((t) => ({ ...t, strategy: s.name })))
    .sort((a, b) => b.exitDate.localeCompare(a.exitDate));
  const input = "num mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5";

  return (
    <div className="space-y-5">
      <Card title="Setup">
        <div className="space-y-4">
          <fieldset>
            <legend className="text-xs text-muted">Strategies</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-2">
              {strategies.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={selected.includes(s.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))}
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(s.id) }} />
                  {s.name}
                  {!s.enabled && <span className="text-xs text-muted">(disabled)</span>}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="text-sm">
              <span className="text-xs text-muted">Period</span>
              <select className={input} value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Symbols</span>
              <select className={input} value={universe} onChange={(e) => setUniverse(e.target.value as "watchlist" | "full")}>
                <option value="watchlist">Pinned watchlist ({watchlistCount})</option>
                <option value="full">Full scan list ({fullCount}, slower)</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Position size % of equity</span>
              <input type="number" min={0.5} max={100} step={0.5} className={input} value={positionPct}
                onChange={(e) => setPositionPct(Number(e.target.value))} />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Max open positions</span>
              <input type="number" min={1} max={50} step={1} className={input} value={maxPositions}
                onChange={(e) => setMaxPositions(Number(e.target.value))} />
            </label>
            <label className="text-sm">
              <span className="text-xs text-muted">Slippage per fill (bps)</span>
              <input type="number" min={0} max={100} step={1} className={input} value={slippageBps}
                onChange={(e) => setSlippageBps(Number(e.target.value))} />
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:text-black"
              disabled={running || !selected.length} onClick={run}
            >{running ? "Running…" : "Run backtest"}</button>
            <span className="text-xs text-muted">
              Uses each strategy&apos;s saved parameters (edit them on Strategies). Today&apos;s symbol list is used for the
              whole period, so names that fell out of the list are missing (survivorship bias).
            </span>
          </div>
          {error && <p className="text-sm text-bad">Backtest failed: {error}</p>}
        </div>
      </Card>

      {result && (
        <div className={`space-y-5 ${running ? "opacity-60" : ""}`}>
          <Card
            title="Return"
            action={<span className="num text-xs text-muted">{result.start} to {result.end} · {result.symbols} symbols</span>}
          >
            <div className="h-72 w-full">
              <ResponsiveContainer>
                <LineChart data={result.curve} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={48}
                    tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => `${v}%`} width={48} domain={["auto", "auto"]}
                    tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                    contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
                    formatter={(v, name) => [pct(Number(v)), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line dataKey={result.benchmark.symbol} name={`${result.benchmark.symbol} buy & hold`} stroke="var(--muted)"
                    strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  {result.strategies.map((s) => (
                    <Line key={s.id} dataKey={s.id} name={s.name} stroke={colorOf(s.id)} strokeWidth={2}
                      dot={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Scoreboard">
            <Table head={["Strategy", "Return", "Max drawdown", "Trades", "Win rate", "Avg trade", "Profit factor", "Sharpe", "Avg hold", "Invested"]}>
              {result.strategies.map((s) => (
                <tr key={s.id}>
                  <td className={td}>
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorOf(s.id) }} />
                    <span className="font-sans">{s.name}</span>
                    {s.direction === "bearish" && <span className="ml-1 text-xs text-muted">short</span>}
                  </td>
                  <td className={`${td} ${signed(s.stats.totalReturnPct)}`}>{pct(s.stats.totalReturnPct)}</td>
                  <td className={td}>{s.stats.maxDrawdownPct.toFixed(2)}%</td>
                  <td className={td}>{s.stats.trades}{s.openAtEnd ? <span className="text-muted"> +{s.openAtEnd} open</span> : null}</td>
                  <td className={td}>{s.stats.trades ? `${s.stats.winRate}%` : "–"}</td>
                  <td className={`${td} ${signed(s.stats.avgTradePct)}`}>{s.stats.trades ? pct(s.stats.avgTradePct) : "–"}</td>
                  <td className={td}>{s.stats.profitFactor ?? "–"}</td>
                  <td className={td}>{s.stats.sharpe ?? "–"}</td>
                  <td className={td}>{s.stats.trades ? `${s.stats.avgHoldDays}d` : "–"}</td>
                  <td className={td}>{s.stats.exposurePct}%</td>
                </tr>
              ))}
              <tr className="text-ink-2">
                <td className={`${td} font-sans`}>{result.benchmark.symbol} buy &amp; hold</td>
                <td className={`${td} ${signed(result.benchmark.totalReturnPct)}`}>{pct(result.benchmark.totalReturnPct)}</td>
                <td className={td}>{result.benchmark.maxDrawdownPct.toFixed(2)}%</td>
                <td className={td} colSpan={6} />
                <td className={td}>100%</td>
              </tr>
            </Table>
            <p className="mt-3 text-xs text-muted">
              Return is on the whole $100,000 account, so a rule that only keeps a little money invested earns little even
              when its trades are good: compare avg trade and profit factor too. Exits:{" "}
              {result.strategies.map((s) => (
                <span key={s.id} className="mr-3">
                  {s.name}: {Object.entries(s.exitReasons).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}
                </span>
              ))}
            </p>
          </Card>

          <Card
            title={`Trades (${trades.length})`}
            action={
              <select className="rounded-md border border-line bg-bg px-2 py-1 text-xs" value={tradeFilter}
                onChange={(e) => setTradeFilter(e.target.value)}>
                <option value="all">All strategies</option>
                {result.strategies.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            }
          >
            <Table
              head={["Strategy", "Symbol", "Entry", "Exit", "Days", "Exit reason", "P&L", "Return"]}
              empty={trades.length ? undefined : "No trades in this period."}
            >
              {trades.slice(0, 200).map((t, i) => (
                <tr key={i}>
                  <td className={`${td} font-sans`}>{t.strategy}</td>
                  <td className={td}>{t.symbol}{t.side === "short" && <span className="ml-1 text-xs text-muted">short</span>}</td>
                  <td className={td}>{t.entryDate} <span className="text-muted">{usd(t.entryPrice)}</span></td>
                  <td className={td}>{t.exitDate} <span className="text-muted">{usd(t.exitPrice)}</span></td>
                  <td className={td}>{t.daysHeld}</td>
                  <td className={td}><Badge>{t.reason}</Badge></td>
                  <td className={`${td} ${signed(t.pnl)}`}>{usd(t.pnl)}</td>
                  <td className={`${td} ${signed(t.pnlPct)}`}>{pct(t.pnlPct)}</td>
                </tr>
              ))}
            </Table>
            {trades.length > 200 && <p className="mt-2 text-xs text-muted">Showing the latest 200.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}
