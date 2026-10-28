import { AutoRefresh } from "@/components/AutoRefresh";
import { SentimentChart } from "@/components/SentimentChart";
import { Badge, Card, Stat, Table, pct, td, tone, usd } from "@/components/ui";
import { getSentimentView } from "@/lib/sentiment";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const signedCls = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "");
const time = (d: Date) =>
  d.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const dayLabel = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export default async function SentimentPage() {
  const [v, settings] = await Promise.all([getSentimentView(), getSettings()]);
  const cfg = settings.sentiment;
  const { stats: s } = v;
  const score = v.latest?.score ?? 0;

  return (
    <div className="space-y-5">
      <AutoRefresh renderedAt={new Date().toISOString()} />
      <div>
        <h1 className="text-lg font-semibold">News sentiment reader <span className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 text-xs font-medium text-warn">SHADOW</span></h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          Every minute in market hours, Claude reads new Benzinga headlines about the index, the largest stocks and
          macro news, and scores each one for what it means for the S&amp;P 500. The scores fade with a{" "}
          {cfg.halfLifeMin}-minute half-life and add up to one market score from -1 to +1. Above +{cfg.entryThreshold} it
          would buy a SPY call, below -{cfg.entryThreshold} a put{cfg.requireVwap ? ", if SPY is on the same side of VWAP" : ""}.
          This is a test: it logs the trades it would take and never places an order.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Market score" value={<span className={signedCls(score)}>{score >= 0 ? "+" : ""}{score.toFixed(2)}</span>}
          sub={v.latest ? `${v.latest.headlines} headlines counting · ${v.latest.note}` : "Waiting for the first market-hours tick"} />
        <Stat label="Shadow P&L" value={usd(s.pnl, 0)} sub={`${s.closed} closed trades · ${s.wins} winners`} tone={tone(s.pnl)} />
        <Stat label="SPY went the score's way" value={s.measured ? `${s.spyRight} / ${s.measured}` : "–"}
          sub={s.avgSpyMovePct != null ? `avg ${pct(s.avgSpyMovePct, 3)} in the trade's direction` : "No closed trades yet"} />
        <Stat label="Skipped signals" value={s.skipped} sub="No contract passed the spread and liquidity filters" />
      </div>

      <Card title={`Score vs SPY · ${dayLabel(v.day)}`}>
        {v.snapshots.length >= 2
          ? <SentimentChart entry={cfg.entryThreshold} data={v.snapshots.map((x) => ({ t: x.t.toISOString(), score: x.score, spy: x.spy }))} />
          : <p className="text-sm text-muted">The chart fills in once the reader has run for a few minutes of market hours.</p>}
        <p className="mt-2 text-xs text-muted">Dotted lines are the entry thresholds. If the score tends to move before SPY does, the reader is finding something.</p>
      </Card>

      <Card title={`Shadow trades (${v.trades.length})`}>
        <Table head={["Opened (ET)", "Side", "Contract", "Score", "SPY move", "Exit", "Return", "P&L", "Driven by"]}
          empty={v.trades.length ? undefined : "No trades yet."}>
          {v.trades.map((t) => (
            <tr key={t.id}>
              <td className={`${td} whitespace-nowrap`}>{time(t.openedAt)}</td>
              <td className={td}><Badge>{t.direction}</Badge></td>
              <td className={`${td} whitespace-nowrap`}>
                {t.contract ? <>${t.strike} {t.direction === "bullish" ? "call" : "put"} · {t.expiration}
                  <div className="text-xs text-muted">{t.qty} @ {usd(t.entryPrice!)} (bid {usd(t.entryBid!)} / ask {usd(t.entryAsk!)})</div></>
                  : <span className="text-muted">skipped: {t.skipReason?.replaceAll("_", " ")}</span>}
              </td>
              <td className={`${td} whitespace-nowrap`}>{t.entryScore.toFixed(2)}{t.exitScore != null && ` → ${t.exitScore.toFixed(2)}`}</td>
              <td className={`${td} ${signedCls(t.spyMovePct ?? 0)}`}>{t.spyMovePct != null ? pct(t.spyMovePct, 3) : "–"}</td>
              <td className={td}>{t.status === "open" ? <Badge>open</Badge> : t.exitReason?.replaceAll("_", " ") ?? "–"}</td>
              <td className={`${td} ${signedCls(t.pnlPct ?? 0)}`}>{t.pnlPct != null ? pct(t.pnlPct, 1) : "–"}</td>
              <td className={`${td} ${signedCls(t.pnl ?? 0)}`}>{t.pnl != null ? usd(t.pnl, 0) : "–"}</td>
              <td className={`${td} max-w-sm text-xs text-ink-2`}>
                {t.drivers.slice(0, 3).map((d) => <div key={d.id}>{d.contribution > 0 ? "▲" : "▼"} {d.headline}</div>)}
              </td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">
          Priced like the bot would trade: bought at the bid-ask midpoint (capped at the ask), sold at the bid. SPY move
          is signed in the trade&apos;s favour.
        </p>
      </Card>

      <Card title="Market-moving headlines">
        <Table head={["Published (ET)", "Headline", "Read", "Impact", "Relevance"]} empty={v.headlines.length ? undefined : "Nothing scored yet."}>
          {v.headlines.map((n) => (
            <tr key={n.id}>
              <td className={`${td} whitespace-nowrap`}>{time(n.publishedAt)}</td>
              <td className={`${td} max-w-xl`}>
                {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="hover:underline">{n.headline}</a> : n.headline}
                {n.reason && <div className="mt-0.5 text-xs text-muted">{n.reason}</div>}
              </td>
              <td className={`${td} text-xs`}>{n.kind.replaceAll("_", " ")}<div className="text-muted">{n.category.replaceAll("_", " ")}</div></td>
              <td className={`${td} ${signedCls(n.impact)}`}>{n.impact >= 0 ? "+" : ""}{n.impact.toFixed(2)}<div className="text-xs text-muted">conf {n.confidence.toFixed(2)}</div></td>
              <td className={td}>{n.relevance.toFixed(2)}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">
          Headlines Claude rated at least 0.3 relevant to the whole index. Only new information counts fully; opinion
          counts at 30%, and recaps and repeats don&apos;t count.
        </p>
      </Card>
    </div>
  );
}
