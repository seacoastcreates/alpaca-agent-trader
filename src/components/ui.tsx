import type { ReactNode } from "react";

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-1 text-xl font-semibold ${tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : ""}`}>{value}</div>
      {sub && <div className="num mt-0.5 text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

const BADGE: Record<string, string> = {
  ordered: "bg-accent/15 text-accent",
  approve: "bg-good/15 text-good",
  vetoed: "bg-bad/15 text-bad",
  veto: "bg-bad/15 text-bad",
  error: "bg-bad/15 text-bad",
  blocked: "bg-ink-2/10 text-ink-2",
  open: "bg-good/15 text-good",
  pending: "bg-warn/15 text-warn",
  closing: "bg-warn/15 text-warn",
  ok: "bg-good/15 text-good",
  market_closed: "bg-ink-2/10 text-ink-2",
  running: "bg-warn/15 text-warn",
};

export function Badge({ children, kind }: { children: ReactNode; kind?: string }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${BADGE[kind ?? String(children)] ?? "bg-ink-2/10 text-ink-2"}`}>
      {children}
    </span>
  );
}

export const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

export const pct = (n: number, dp = 2) => `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;

export const tone = (n: number) => (n > 0 ? "good" : n < 0 ? "bad" : undefined);

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: string }) {
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {head.map((h, i) => <th key={i} className="px-4 pb-2 font-medium">{h}</th>)}
          </tr>
        </thead>
        <tbody className="num">{children}</tbody>
      </table>
      {empty && <p className="px-4 py-3 text-sm text-muted">{empty}</p>}
    </div>
  );
}

export const td = "border-t border-line px-4 py-2 align-top";
