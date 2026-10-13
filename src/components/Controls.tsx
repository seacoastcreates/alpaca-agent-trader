"use client";

import { useState, useTransition } from "react";
import { flatten, previewSignals, runTickNow, setKillSwitch } from "@/app/actions";

const btn = "rounded-md border border-line px-3 py-1.5 text-sm hover:bg-ink/5 disabled:opacity-50";

export function Controls({ killSwitch }: { killSwitch: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmFlatten, setConfirmFlatten] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={pending} onClick={() => start(async () => {
          const r = await previewSignals();
          setMsg(r.ok
            ? `Preview${r.gate ? ` (entries gated: ${r.gate})` : ""}: ${r.candidates.length ? r.candidates.map((c) => `${c.symbol} via ${c.strategy}`).join(", ") : "no entry signals"}${r.exits.length ? `. Exits: ${r.exits.join(", ")}` : ""}`
            : r.error);
        })}>Preview signals</button>
        <button className={btn} disabled={pending} onClick={() => start(async () => {
          const r = await runTickNow();
          setMsg(r.ok
            ? `Run ${r.status}${r.gate ? `, entries gated: ${r.gate}` : ""}. Entries: ${r.entries.join(", ") || "none"}. Exits: ${r.exits.join(", ") || "none"}.`
            : r.error);
        })}>Run now</button>
        <button
          className={`${btn} ${killSwitch ? "border-bad text-bad" : ""}`} disabled={pending}
          onClick={() => start(() => setKillSwitch(!killSwitch))}
        >{killSwitch ? "Kill switch ON (resume entries)" : "Kill switch (stop new entries)"}</button>
        {!confirmFlatten ? (
          <button className={btn} disabled={pending} onClick={() => setConfirmFlatten(true)}>Flatten all…</button>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            Sell every bot position at market?
            <button className={`${btn} border-bad text-bad`} disabled={pending} onClick={() => start(async () => {
              setConfirmFlatten(false);
              const r = await flatten();
              setMsg(r.ok ? `Closing: ${r.closed.join(", ") || "nothing open"}` : r.error);
            })}>Yes, flatten</button>
            <button className={btn} onClick={() => setConfirmFlatten(false)}>Cancel</button>
          </span>
        )}
      </div>
      {pending && <p className="text-sm text-muted">Working…</p>}
      {msg && !pending && <p className="text-sm text-ink-2">{msg}</p>}
    </div>
  );
}
