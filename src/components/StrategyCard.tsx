"use client";

import { useState, useTransition } from "react";
import { resetStrategy, updateStrategy } from "@/app/actions";
import type { ParamMeta } from "@/lib/strategies/types";

type Props = {
  id: string;
  name: string;
  rules: string;
  enabled: boolean;
  params: Record<string, number | boolean>;
  meta: Record<string, ParamMeta>;
  stats?: { trades: number; winRate: number; totalPnl: number; avgPnlPct: number };
  openCount: number;
  canEdit: boolean;
};

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });

export function StrategyCard(p: Props) {
  const [enabled, setEnabled] = useState(p.enabled);
  const [params, setParams] = useState(p.params);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const dirty = JSON.stringify(params) !== JSON.stringify(p.params);

  const save = (nextEnabled = enabled) =>
    start(async () => {
      try {
        await updateStrategy(p.id, nextEnabled, params);
        setMsg("Saved");
      } catch (e) {
        setMsg(String(e));
      }
    });

  return (
    <section className="rounded-lg border border-line bg-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="font-semibold">{p.name}</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-2">{p.rules}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox" checked={enabled} disabled={pending || !p.canEdit} className="h-4 w-4 accent-[var(--accent)]"
            onChange={(e) => { setEnabled(e.target.checked); save(e.target.checked); }}
          />
          {enabled ? "Enabled" : "Disabled"}
        </label>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-line bg-line text-sm md:grid-cols-5">
        {[
          ["Open", String(p.openCount)],
          ["Closed trades", String(p.stats?.trades ?? 0)],
          ["Win rate", p.stats ? `${p.stats.winRate}%` : "–"],
          ["Avg trade", p.stats ? `${p.stats.avgPnlPct >= 0 ? "+" : ""}${p.stats.avgPnlPct}%` : "–"],
          ["Total P&L", p.stats ? usd(p.stats.totalPnl) : "–"],
        ].map(([k, v]) => (
          <div key={k} className="bg-panel px-4 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className="num font-medium">{v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(p.meta).map(([k, m]) =>
          typeof params[k] === "boolean" ? (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={Boolean(params[k])} disabled={!p.canEdit} className="h-4 w-4 accent-[var(--accent)]"
                onChange={(e) => setParams({ ...params, [k]: e.target.checked })}
              />
              {m.label}
            </label>
          ) : (
            <label key={k} className="text-sm">
              <span className="text-xs text-muted">{m.label}</span>
              <input
                type="number" min={m.min} max={m.max} step={m.step} value={String(params[k])} readOnly={!p.canEdit}
                className="num mt-1 block w-full rounded-md border border-line bg-bg px-2 py-1.5"
                onChange={(e) => setParams({ ...params, [k]: e.target.value === "" ? "" as unknown as number : Number(e.target.value) })}
              />
            </label>
          ),
        )}
      </div>

      {p.canEdit && <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <button
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:text-black"
          disabled={!dirty || pending} onClick={() => save()}
        >Save parameters</button>
        <button
          className="rounded-md border border-line px-3 py-1.5 text-sm disabled:opacity-50" disabled={pending}
          onClick={() => start(async () => { await resetStrategy(p.id); setMsg("Reset to defaults, reload to see them"); })}
        >Reset to defaults</button>
        {msg && <span className="text-sm text-muted">{msg}</span>}
      </div>}
    </section>
  );
}
