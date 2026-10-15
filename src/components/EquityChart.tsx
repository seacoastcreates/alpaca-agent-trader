"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { RANGES, type EquityPoint, type Range } from "@/lib/equity-ranges";

const STORAGE_KEY = "aat.equityRange";
const ET = "America/New_York";

const money = (n: number, dp = 0) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

function tickLabel(t: number, range: Range) {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString("en-US", { timeZone: ET, hour: "numeric", minute: "2-digit" });
  if (range === "1W") return d.toLocaleDateString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); // daily points are UTC midnights
}

/** Weekly view: one tick per trading day (its first point) instead of a label on every hour. */
function dayTicks(data: EquityPoint[]) {
  const seen = new Set<string>();
  return data
    .filter((p) => {
      const day = new Date(p.t).toLocaleDateString("en-US", { timeZone: ET });
      return seen.has(day) ? false : (seen.add(day), true);
    })
    .map((p) => p.t);
}

function tooltipLabel(t: number, range: Range) {
  const d = new Date(t);
  return range === "1D" || range === "1W"
    ? `${d.toLocaleString("en-US", { timeZone: ET, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET`
    : d.toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/**
 * Equity chart with Daily / Weekly / Monthly / 3-Month ranges. The page renders the default range server-side;
 * other ranges load from /api/equity. `refreshKey` changes on each auto-refresh, which re-fetches the shown range.
 */
export function EquityChart({ initial, initialRange, refreshKey }: {
  initial: EquityPoint[]; initialRange: Range; refreshKey: string;
}) {
  const [range, setRange] = useState<Range>(initialRange);
  const [cache, setCache] = useState<Partial<Record<Range, EquityPoint[]>>>({ [initialRange]: initial });
  const [error, setError] = useState<string | null>(null);

  // Restore the last range this viewer picked (a per-browser convenience; safe to lose).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && saved in RANGES && saved !== initialRange) setRange(saved as Range);
    } catch {}
  }, [initialRange]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetch(`/api/equity?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: { points: EquityPoint[] }) => !cancelled && setCache((c) => ({ ...c, [range]: d.points })))
      .catch((e) => !cancelled && setError(String(e.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [range, refreshKey]);

  function choose(r: Range) {
    setRange(r);
    try {
      localStorage.setItem(STORAGE_KEY, r);
    } catch {}
  }

  const data = cache[range];
  const first = data?.[0]?.equity;
  const last = data?.at(-1)?.equity;
  const change = first != null && last != null ? last - first : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-line p-0.5 text-xs" role="tablist" aria-label="Chart range">
          {(Object.keys(RANGES) as Range[]).map((r) => (
            <button
              key={r} type="button" role="tab" aria-selected={r === range} onClick={() => choose(r)}
              className={`rounded px-2.5 py-1 ${r === range ? "bg-accent/15 font-medium text-accent" : "text-ink-2 hover:bg-ink/5"}`}
            >
              {RANGES[r].label}
            </button>
          ))}
        </div>
        {change != null && first ? (
          <div className={`num text-sm ${change >= 0 ? "text-good" : "text-bad"}`}>
            {change >= 0 ? "+" : ""}{money(change, 2)} ({change >= 0 ? "+" : ""}{((change / first) * 100).toFixed(2)}%)
            <span className="ml-1 text-xs text-muted">over this range</span>
          </div>
        ) : null}
      </div>

      {error && !data && <p className="text-sm text-bad">Couldn&apos;t load the chart: {error}</p>}
      {!data && !error && <p className="text-sm text-muted">Loading…</p>}
      {data && data.length < 2 && (
        <p className="text-sm text-muted">Not enough history for this range yet.</p>
      )}
      {data && data.length >= 2 && (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="t" tickFormatter={(t) => tickLabel(t, range)} minTickGap={40}
                ticks={range === "1W" ? dayTicks(data) : undefined}
                tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false}
              />
              <YAxis
                tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={72}
                domain={["auto", "auto"]} tickFormatter={(v) => money(v)}
              />
              <Tooltip
                cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
                contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
                labelFormatter={(t) => tooltipLabel(Number(t), range)}
                formatter={(v) => [money(Number(v), 2), "Equity"]}
              />
              <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} fill="url(#eq)" activeDot={{ r: 4 }} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
