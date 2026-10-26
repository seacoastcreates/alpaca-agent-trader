import { BacktestRunner } from "@/components/BacktestRunner";
import { ReturnChart } from "@/components/ReturnChart";
import { Ticker } from "@/components/Ticker";
import { Badge, Card, Stat, Table, pct, td, tone, usd } from "@/components/ui";
import { loadStrategies } from "@/lib/engine";
import { getPerformance, type Group } from "@/lib/performance";
import { getSettings } from "@/lib/settings";
import { getUniverse } from "@/lib/universe";

export const dynamic = "force-dynamic";

const signedCls = (n: number) => (n > 0 ? "text-good" : n < 0 ? "text-bad" : "");
const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

function GroupTable({ rows }: { rows: Group[] }) {
  return (
    <Table head={["", "Trades", "Win rate", "Avg", "P&L"]}>
      {rows.map((g) => (
        <tr key={g.key}>
          <td className={`${td} font-sans`}>{g.key}</td>
          <td className={td}>{g.trades}</td>
          <td className={td}>{g.winRate}%</td>
          <td className={`${td} ${signedCls(g.avgPct)}`}>{pct(g.avgPct, 1)}</td>
          <td className={`${td} ${signedCls(g.pnl)}`}>{usd(g.pnl, 0)}</td>
        </tr>
      ))}
    </Table>
  );
}

export default async function PerformancePage() {
  const [perf, active, settings, universe] = await Promise.all([getPerformance(), loadStrategies(), getSettings(), getUniverse()]);
  const fullCount = new Set([...settings.watchlist, ...(settings.universe.enabled ? universe?.symbols ?? [] : [])]).size;
  const { summary: s, account: a, vsStock: v, claude } = perf;

  return (
    <div className="space-y-8">
      <section className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold">Your trading</h1>
          <p className="mt-1 text-sm text-ink-2">
            {perf.since
              ? `Every round trip the bot has closed on this account since ${day(perf.since)}, and what the numbers say about where it makes and loses money.`
              : "No closed trades yet. This fills in as the bot closes positions."}
          </p>
        </div>

        {perf.since && (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Net P&L (closed trades)" value={usd(s.netPnl, 0)} sub={`${s.trades} trades · ${usd(s.expectancy, 0)} per trade`} tone={tone(s.netPnl)} />
              <Stat label="Account" value={pct(a.returnPct)} sub={a.spyReturnPct != null ? `SPY ${pct(a.spyReturnPct)} · max drawdown ${a.maxDrawdownPct}%` : undefined} tone={tone(a.returnPct)} />
              <Stat label="Win rate" value={`${s.winRate}%`} sub={`avg win ${usd(s.avgWin, 0)} · avg loss ${usd(s.avgLoss, 0)}`} />
              <Stat label="Profit factor" value={s.profitFactor ?? "–"} sub="$ won per $ lost (above 1 is profitable)" />
            </div>

            <Card title="What stands out">
              <ul className="list-disc space-y-1.5 pl-5 text-sm">
                {perf.findings.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </Card>

            <Card title="Account vs SPY" action={<span className="num text-xs text-muted">{usd(a.startEquity, 0)} → {usd(a.equity, 0)}</span>}>
              {perf.curve.length >= 2 ? <ReturnChart data={perf.curve} /> : <p className="text-sm text-muted">Not enough history yet.</p>}
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              {perf.groups.map((g) => <Card key={g.title} title={g.title}><GroupTable rows={g.rows} /></Card>)}

              {v && (
                <Card title="The stock's move vs the trade's result">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-muted">Stock went the rule&apos;s way</div>
                      <div className="num text-lg font-semibold">{v.stockRight} / {v.measured}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Trades that made money</div>
                      <div className="num text-lg font-semibold">{v.optionWon} / {v.measured}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Avg stock move, rule&apos;s direction</div>
                      <div className={`num text-lg font-semibold ${signedCls(v.avgStockMovePct)}`}>{pct(v.avgStockMovePct)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted">Same moves in shares ({v.sharesPositionPct}% size)</div>
                      <div className={`num text-lg font-semibold ${signedCls(v.sharesPnl)}`}>{usd(v.sharesPnl, 0)}</div>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Separates the signal from the instrument. If the stock rarely goes the rule&apos;s way, the rule is the
                    problem; if it does but the trade still loses, the options (spread, decay, sizing) are. Bearish moves
                    count as a short.
                  </p>
                </Card>
              )}

              <Card title="Claude's reviews">
                <Table head={["Signals", "Count", `Checked after 3 sessions`, "Went the rule's way", "Avg move"]}>
                  {claude.outcomes.map((o) => (
                    <tr key={o.label}>
                      <td className={`${td} font-sans`}>{o.label}</td>
                      <td className={td}>{o.total}</td>
                      <td className={td}>{o.matured}</td>
                      <td className={td}>{o.matured ? `${o.wentRight} (${Math.round((o.wentRight / o.matured) * 100)}%)` : "–"}</td>
                      <td className={`${td} ${signedCls(o.avgMovePct ?? 0)}`}>{o.avgMovePct != null ? pct(o.avgMovePct) : "–"}</td>
                    </tr>
                  ))}
                </Table>
                <p className="mt-3 text-xs text-muted">
                  The stock&apos;s move from the signal price to the close 3 sessions later. If vetoed stocks do worse than
                  approved ones, the vetoes are earning their keep.
                  {claude.minConfidence != null && ` Confidence on traded entries ranged ${claude.minConfidence}-${claude.maxConfidence}.`}
                </p>
              </Card>

              <Card title="Signals the risk rules blocked">
                <Table head={["Reason", "Signals", "Days"]}>
                  {perf.blocked.map((b) => (
                    <tr key={b.reason}>
                      <td className={`${td} font-sans`}>{b.reason.replaceAll("_", " ")}</td>
                      <td className={td}>{b.count}</td>
                      <td className={td}>{b.days}</td>
                    </tr>
                  ))}
                </Table>
                <p className="mt-3 text-xs text-muted">One signal is logged per symbol per tick, so a busy rule repeats; days shows how often it applied.</p>
              </Card>
            </div>

            <Card title={`Trades (${perf.trades.length})`}>
              <Table head={["Closed", "Symbol", "Strategy", "Type", "Held", "Exit", "Stock move", "Return", "P&L"]}>
                {perf.trades.map((t) => (
                  <tr key={t.id}>
                    <td className={`${td} whitespace-nowrap`}>{day(t.closedAt)}</td>
                    <td className={td}><Ticker symbol={t.symbol} /></td>
                    <td className={`${td} font-sans`}>{t.strategy}</td>
                    <td className={td}>{t.instrument}</td>
                    <td className={td}>{t.holdSessions == null ? "–" : t.holdSessions <= 1 ? "same day" : `${t.holdSessions - 1}n`}</td>
                    <td className={td}><Badge>{t.exitReason}</Badge></td>
                    <td className={`${td} ${signedCls(t.stockMovePct ?? 0)}`}>{t.stockMovePct != null ? pct(t.stockMovePct) : "–"}</td>
                    <td className={`${td} ${signedCls(t.pnlPct)}`}>{pct(t.pnlPct, 1)}</td>
                    <td className={`${td} ${signedCls(t.pnl)}`}>{usd(t.pnl, 0)}</td>
                  </tr>
                ))}
              </Table>
              <p className="mt-2 text-xs text-muted">Stock move is signed in the rule&apos;s favour: + means the stock went the way the trade bet.</p>
            </Card>
          </>
        )}
      </section>

      <section className="space-y-5 border-t border-line pt-6">
        <div>
          <h2 className="text-lg font-semibold">Strategy backtest</h2>
          <p className="mt-1 text-sm text-ink-2">
            How the rules would have done over past years, to put the live record in context. Replays each strategy&apos;s
            own rules, with its saved settings, over daily bars; each gets its own $100,000 account. Signals fill at the
            day&apos;s close; stops and targets fill at their level when the day&apos;s range touches them (at the open on a
            gap). Bearish rules are scored as a short of the stock, not puts, and the Claude reviewer is left out.
          </p>
        </div>
        <BacktestRunner
          strategies={active.map((x) => ({ id: x.def.id, name: x.def.name, direction: x.def.direction, enabled: x.enabled }))}
          defaults={{ positionPct: settings.risk.maxPositionPct, maxPositions: settings.risk.maxPositionsPerStrategy }}
          watchlistCount={settings.watchlist.length}
          fullCount={fullCount}
        />
      </section>
    </div>
  );
}
