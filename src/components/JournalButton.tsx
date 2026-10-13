"use client";

import { useState, useTransition } from "react";
import { generateJournal } from "@/app/actions";

export function JournalButton() {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      {err && <span className="text-xs text-bad">{err}</span>}
      <button
        className="rounded-md border border-line px-2.5 py-1 text-xs hover:bg-ink/5 disabled:opacity-50" disabled={pending}
        onClick={() => start(async () => { const r = await generateJournal(); setErr(r.ok ? null : r.error); })}
      >{pending ? "Writing…" : "Write today's entry now"}</button>
    </span>
  );
}
