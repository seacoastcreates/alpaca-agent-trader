import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { Badge, Card, Table, pct, td, usd } from "@/components/ui";
import { db, signals, trades } from "@/lib/db";
import { STRATEGY_BY_ID } from "@/lib/strategies";

export const dynamic = "force-dynamic";

const FILTERS = ["all", "ordered", "vetoed", "blocked", "error"] as const;

const time = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "all" } = await searchParams;
  const [rows, closed] = await Promise.all([
    db.select().from(signals)
      .where(status === "all" ? undefined : eq(signals.status, status))
      .orderBy(desc(signals.createdAt)).limit(150),
    db.select().from(trades).orderBy(desc(trades.closedAt)).limit(50),
  ]);

  return (
    <div className="space-y-5">
      <Card
        title="Signals and decisions"
        action={
          <div className="flex flex-wrap gap-1 text-xs">
            {FILTERS.map((f) => (
              <Link key={f} href={f === "all" ? "/activity" : `/activity?status=${f}`}
                className={`rounded px-2 py-1 ${f === status ? "bg-accent/15 text-accent" : "text-ink-2 hover:bg-ink/5"}`}>
                {f}
              </Link>
            ))}
          </div>
        }
      >
        <Table head={["Time (ET)", "Symbol", "Strategy", "Side", "Price", "Outcome", "Why"]} empty={rows.length ? undefined : "Nothing yet."}>
          {rows.map((s) => (
            <tr key={s.id}>
              <td className={`${td} whitespace-nowrap`}>{time(s.createdAt)}</td>
              <td className={`${td} font-medium`}>{s.symbol}</td>
              <td className={td}>{STRATEGY_BY_ID[s.strategyId]?.name ?? s.strategyId}</td>
              <td className={td}>{s.kind === "entry" ? "buy" : "sell"}</td>
              <td className={td}>{usd(s.price)}</td>
              <td className={td}>
                <Badge>{s.status}</Badge>
                {s.review && <div className="mt-1"><Badge kind={s.review.decision}>Claude: {s.review.decision} {Math.round(s.review.confidence * 100)}%</Badge></div>}
              </td>
              <td className={`${td} max-w-md text-ink-2`}>
                <div>{s.review?.reason ?? s.reason ?? "–"}</div>
                {s.review?.risks?.length ? <div className="mt-1 text-xs text-muted">Risks: {s.review.risks.join("; ")}</div> : null}
                <div className="mt-1 text-xs text-muted">{Object.entries(s.indicators).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Closed trades">
        <Table head={["Closed (ET)", "Symbol", "Strategy", "Qty", "Entry", "Exit", "P&L", "Exit reason"]} empty={closed.length ? undefined : "No closed trades yet."}>
          {closed.map((t) => (
            <tr key={t.id}>
              <td className={`${td} whitespace-nowrap`}>{time(t.closedAt)}</td>
              <td className={`${td} font-medium`}>{t.symbol}</td>
              <td className={td}>{STRATEGY_BY_ID[t.strategyId]?.name ?? t.strategyId}</td>
              <td className={td}>{t.qty}</td>
              <td className={td}>{usd(t.entryPrice)}</td>
              <td className={td}>{usd(t.exitPrice)}</td>
              <td className={`${td} ${t.pnl >= 0 ? "text-good" : "text-bad"}`}>{pct(t.pnlPct)} ({usd(t.pnl)})</td>
              <td className={td}>{t.exitReason.replace(/_/g, " ")}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
