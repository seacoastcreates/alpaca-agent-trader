"use client";

import { useState, useTransition } from "react";
import { closePositionNow } from "@/app/actions";

const btn = "rounded-md border border-line px-2 py-1 text-xs hover:bg-ink/5 disabled:opacity-50";

export function ClosePositionButton({ symbol, label, pending: entryPending }: { symbol: string; label: string; pending: boolean }) {
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (msg) return <span className={`text-xs ${msg.ok ? "text-ink-2" : "text-bad"}`}>{msg.text}</span>;
  if (!confirm) return <button className={btn} onClick={() => setConfirm(true)}>{entryPending ? "Cancel" : "Close"}</button>;
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      {entryPending ? `Cancel the ${label} buy?` : `Sell ${label}?`}
      <button className={`${btn} border-bad text-bad`} disabled={pending} onClick={() => start(async () => {
        const r = await closePositionNow(symbol);
        setConfirm(false);
        setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
      })}>{pending ? "Working…" : "Yes"}</button>
      <button className={btn} disabled={pending} onClick={() => setConfirm(false)}>No</button>
    </span>
  );
}
