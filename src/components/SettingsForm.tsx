"use client";

import { useState, useTransition } from "react";
import { saveSettingsAction } from "@/app/actions";
import type { Settings } from "@/lib/settings";

const input = "num mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm";

const RISK_FIELDS: [keyof Settings["risk"], string, string][] = [
  ["maxPositionPct", "Position size (% of equity)", "number"],
  ["maxOpenPositions", "Max open positions", "number"],
  ["maxPositionsPerStrategy", "Max positions per strategy", "number"],
  ["maxNewEntriesPerDay", "Max new entries per day", "number"],
  ["dailyLossLimitPct", "Halt entries when day is down (%)", "number"],
  ["minPrice", "Minimum share price ($)", "number"],
  ["cooldownDays", "Re-entry cooldown (days)", "number"],
  ["entryStartET", "Entry window start (ET)", "time"],
  ["entryEndET", "Entry window end (ET)", "time"],
];

export function SettingsForm({ initial }: { initial: Settings }) {
  const [s, setS] = useState(initial);
  const [watchlist, setWatchlist] = useState(initial.watchlist.join(", "));
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = () =>
    start(async () => {
      const list = [...new Set(watchlist.toUpperCase().split(/[\s,]+/).filter(Boolean))];
      const r = await saveSettingsAction({ ...s, watchlist: list });
      setMsg(r.ok ? { ok: true, text: "Saved" } : { ok: false, text: r.error });
    });

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Watchlist</h2>
        <p className="mt-1 text-xs text-muted">Symbols the strategies scan. Comma or space separated.</p>
        <textarea className={`${input} mt-2 h-24 font-mono`} value={watchlist} onChange={(e) => setWatchlist(e.target.value)} />
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
