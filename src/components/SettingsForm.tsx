"use client";

import { useState, useTransition } from "react";
import { refreshUniverseNow, saveSettingsAction } from "@/app/actions";
import type { Settings } from "@/lib/settings";

const input = "num mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm";

const OPTION_FIELDS: [keyof Settings["options"], string][] = [
  ["premiumPct", "Premium per trade (% of equity)"],
  ["targetDelta", "Target delta (absolute)"],
  ["minDelta", "Min delta (absolute)"],
  ["maxDelta", "Max delta (absolute)"],
  ["targetDte", "Target days to expiry"],
  ["minDte", "Min days to expiry"],
  ["maxDte", "Max days to expiry"],
  ["minOpenInterest", "Min open interest"],
  ["maxSpreadPct", "Max bid-ask spread (% of mid)"],
  ["premiumStopPct", "Sell if option loses (%)"],
  ["premiumTargetPct", "Sell if option gains (%)"],
  ["closeAtDte", "Sell at days to expiry"],
  ["entryTimeoutMin", "Cancel unfilled buy after (min)"],
];

const RISK_FIELDS: [keyof Settings["risk"], string, string][] = [
  ["maxPositionPct", "Share position size (% of equity)", "number"],
  ["maxOpenPositions", "Max open positions", "number"],
  ["maxPositionsPerStrategy", "Max positions per strategy", "number"],
  ["maxPositionsPerSector", "Max positions per sector", "number"],
  ["maxNewEntriesPerDay", "Max new entries per day", "number"],
  ["dailyLossLimitPct", "Halt entries when day is down (%)", "number"],
  ["minPrice", "Minimum share price ($)", "number"],
  ["cooldownDays", "Re-entry cooldown (days)", "number"],
  ["entryStartET", "Entry window start (ET)", "time"],
  ["entryEndET", "Entry window end (ET)", "time"],
];

type UniverseStatus = { count: number; etfs: number; computedAt: string; preview: string[] } | null;

export function SettingsForm({ initial, universe }: { initial: Settings; universe: UniverseStatus }) {
  const [s, setS] = useState(initial);
  const [watchlist, setWatchlist] = useState(initial.watchlist.join(", "));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uMsg, setUMsg] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();

  const save = () =>
    start(async () => {
      const list = [...new Set(watchlist.toUpperCase().split(/[\s,]+/).filter(Boolean))];
      const r = await saveSettingsAction({ ...s, watchlist: list });
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Most-active universe</h2>
        <p className="mt-1 text-xs text-muted">
          The top stocks and ETFs by average daily dollar volume over the last 30 trading days (single-stock ETFs
          excluded), recomputed automatically
          before the open when the list is older than the refresh interval.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.universe.enabled}
              onChange={(e) => setS({ ...s, universe: { ...s.universe, enabled: e.target.checked } })} />
            Scan the universe
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Number of stocks</span>
            <input type="number" className={input} value={s.universe.size}
              onChange={(e) => setS({ ...s, universe: { ...s.universe, size: Number(e.target.value) } })} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Number of ETFs</span>
            <input type="number" className={input} value={s.universe.etfCount}
              onChange={(e) => setS({ ...s, universe: { ...s.universe, etfCount: Number(e.target.value) } })} />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Stock exchanges</span>
            <span className="mt-1 flex gap-3 py-1.5">
              {["NYSE", "NASDAQ"].map((x) => (
                <span key={x} className="flex items-center gap-1.5">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.universe.exchanges.includes(x)}
                    onChange={(e) => setS({ ...s, universe: { ...s.universe, exchanges: e.target.checked
                      ? [...s.universe.exchanges, x] : s.universe.exchanges.filter((y) => y !== x) } })} />
                  {x}
                </span>
              ))}
            </span>
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Refresh every (days)</span>
            <input type="number" className={input} value={s.universe.refreshDays}
              onChange={(e) => setS({ ...s, universe: { ...s.universe, refreshDays: Number(e.target.value) } })} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-ink-2">
            {universe
              ? `${universe.count - universe.etfs} stocks + ${universe.etfs} ETFs, ranked ${new Date(universe.computedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
              : "Not computed yet"}
          </span>
          <button className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-50" disabled={refreshing}
            onClick={() => startRefresh(async () => {
              const r = await refreshUniverseNow();
              setUMsg(r.ok ? `Ranked ${r.count} stocks` : r.error);
            })}>
            {refreshing ? "Ranking ~12,000 listings…" : "Refresh now"}
          </button>
          {uMsg && <span className="text-muted">{uMsg}</span>}
        </div>
        <p className="mt-1 text-xs text-muted">Save settings first if you changed the size or exchanges.</p>
        {universe && (
          <p className="mt-2 font-mono text-xs leading-relaxed text-muted">
            {universe.preview.join(" ")}{universe.count > universe.preview.length ? ` … +${universe.count - universe.preview.length} more` : ""}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Pinned symbols</h2>
        <p className="mt-1 text-xs text-muted">Always scanned, in addition to the universe. Comma or space separated.</p>
        <textarea className={`${input} mt-2 h-24 font-mono`} value={watchlist} onChange={(e) => setWatchlist(e.target.value)} />
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">What a buy signal buys</h2>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {(["shares", "options"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input type="radio" name="instrument" className="accent-[var(--accent)]" checked={s.instrument === k}
                onChange={() => setS({ ...s, instrument: k })} />
              {k === "shares"
                ? "Shares, bullish rules only (broker-held stop and target)"
                : "Options: calls on bullish signals, puts on bearish signals"}
            </label>
          ))}
        </div>
        {s.instrument === "options" && (
          <>
            <p className="mt-3 text-xs text-muted">
              Each signal buys the call (bullish) or put (bearish) closest to the target delta and expiry that passes the
              liquidity filters, with a limit order at the midpoint of the bid and ask (cancelled if it hasn&apos;t filled in time). Options have no stop orders at the broker, so every minute
              the bot sells if the stock hits the strategy&apos;s stop or target, the option hits the loss or gain limit,
              expiry gets close, or the strategy&apos;s exit rule fires. Existing positions keep the instrument they were
              opened with.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {OPTION_FIELDS.map(([k, label]) => (
                <label key={k} className="text-sm">
                  <span className="text-xs text-muted">{label}</span>
                  <input type="number" step="any" className={input} value={String(s.options[k])}
                    onChange={(e) => setS({ ...s, options: { ...s.options, [k]: Number(e.target.value) } })} />
                </label>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Risk rules</h2>
        <p className="mt-1 text-xs text-muted">Hard limits that apply to every strategy. Claude can never override these.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RISK_FIELDS.map(([k, label, type]) => (
            <label key={k} className="text-sm">
              <span className="text-xs text-muted">{label}</span>
              <input
                type={type} className={input} value={String(s.risk[k])}
                onChange={(e) => setS({ ...s, risk: { ...s.risk, [k]: type === "number" ? Number(e.target.value) : e.target.value } })}
              />
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Claude reviewer</h2>
        <p className="mt-1 text-xs text-muted">
          Each new entry candidate is reviewed once per day against recent headlines and price action.
          Veto mode blocks the trade when Claude objects. Advisory mode only records Claude&apos;s opinion.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={s.agent.enabled}
              onChange={(e) => setS({ ...s, agent: { ...s.agent, enabled: e.target.checked } })} />
            Reviewer enabled
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Mode</span>
            <select className={input} value={s.agent.mode}
              onChange={(e) => setS({ ...s, agent: { ...s.agent, mode: e.target.value as "veto" | "advisory" } })}>
              <option value="veto">Veto</option>
              <option value="advisory">Advisory</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Model</span>
            <select className={input} value={s.agent.model}
              onChange={(e) => setS({ ...s, agent: { ...s.agent, model: e.target.value } })}>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
              <option value="claude-opus-5-5">Claude Opus 5.5</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Max reviews per day</span>
            <input type="number" className={input} value={s.agent.maxReviewsPerDay}
              onChange={(e) => setS({ ...s, agent: { ...s.agent, maxReviewsPerDay: Number(e.target.value) } })} />
          </label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-black" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save settings"}
        </button>
        {msg && <span className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
