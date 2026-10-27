import { desc } from "drizzle-orm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Controls } from "@/components/Controls";
import { ReadOnlyNote } from "@/components/ReadOnlyNote";
import { EquityChart } from "@/components/EquityChart";
import { Ticker } from "@/components/Ticker";
import { Badge, Card, Stat, Table, pct, td, tone, usd } from "@/components/ui";
import * as alpaca from "@/lib/alpaca";
import { db, positions, runs } from "@/lib/db";
import { equityHistory } from "@/lib/equity";
import { isOwner } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { STRATEGY_BY_ID } from "@/lib/strategies";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const owner = await isOwner();
  let data;
  try {
    data = await Promise.all([
      getSettings(),
      alpaca.getAccount(),
      alpaca.getClock(),
      alpaca.getPositions(),
      db.select().from(positions),
      equityHistory("1D").catch(() => []),
      db.select().from(runs).orderBy(desc(runs.startedAt)).limit(8),
    ]);
  } catch (err) {
    const authFailed = err instanceof alpaca.AlpacaError && (err.status === 401 || err.status === 403);
    return (
      <Card title="Can't load the dashboard">
        <p className="text-sm text-bad">
          {authFailed
            ? "Alpaca rejected the API keys. Check ALPACA_KEY_ID and ALPACA_SECRET_KEY (paper account keys)."
            : String(err instanceof Error ? err.message : err).slice(0, 400)}
        </p>
      </Card>
    );
  }
  const [settings, account, clock, live, ours, history, recentRuns] = data;

  const equity = Number(account.equity);
  const lastEquity = Number(account.last_equity);
  const dayPnl = equity - lastEquity;
  const dayPnlPct = lastEquity ? (dayPnl / lastEquity) * 100 : 0;
  const halted = dayPnlPct <= -settings.risk.dailyLossLimitPct;
  const liveBySymbol = new Map(live.map((p) => [p.symbol, p]));
  const unmanaged = live.filter((p) => !ours.some((o) => (o.contract ?? o.symbol) === p.symbol));

  const renderedAt = new Date().toISOString();

  const lastRun = recentRuns[0];

  return (
    <div className="space-y-5">
      <AutoRefresh renderedAt={renderedAt} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Equity" value={usd(equity)} sub={`Cash ${usd(Number(account.cash), 0)}`} />
        <Stat label="Today" value={usd(dayPnl)} sub={pct(dayPnlPct)} tone={tone(dayPnl)} />
        <Stat label="Bot positions" value={`${ours.length} / ${settings.risk.maxOpenPositions}`} sub={`${unmanaged.length} unmanaged`} />
        <Stat
          label="Status"
          value={settings.killSwitch ? "Kill switch" : halted ? "Halted" : clock.is_open ? "Trading" : "Market closed"}
          sub={lastRun ? `Last run ${lastRun.startedAt.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })} ET` : "No runs yet"}
          tone={settings.killSwitch || halted ? "bad" : undefined}
        />
      </div>

      <Card title="Controls">
        {owner ? <Controls killSwitch={settings.killSwitch} /> : <ReadOnlyNote next="/">The bot trades on its own every minute; controls are for the owner.</ReadOnlyNote>}
      </Card>

      <Card title="Equity">
        <EquityChart initial={history} initialRange="1D" refreshKey={renderedAt} />
      </Card>

      <Card title="Bot positions">
        <Table
          head={["Symbol", "Strategy", "State", "Qty", "Entry", "Last", "P&L", "Stop / target"]}
          empty={ours.length ? undefined : "No positions yet. Entries happen when a rule fires inside the entry window."}
        >
          {ours.map((p) => {
            const lp = liveBySymbol.get(p.contract ?? p.symbol);
            const last = lp ? Number(lp.current_price) : null;
            const plPct = lp ? Number(lp.unrealized_plpc) * 100 : null;
            return (
              <tr key={p.symbol}>
                <td className={`${td} font-medium`}>
                  <Ticker symbol={p.symbol} />
                  {p.contract && (
                    <div className="text-xs font-normal text-muted">${p.strike} {p.instrument} · {p.expiration}</div>
                  )}
                </td>
                <td className={td}>
                  {STRATEGY_BY_ID[p.strategyId]?.name ?? p.strategyId}
                  {p.sector && <div className="text-xs text-muted">{p.sector}</div>}
                </td>
                <td className={td}><Badge>{p.state}</Badge></td>
                <td className={td}>{p.qty}{p.contract && <span className="text-xs text-muted"> contracts</span>}</td>
                <td className={td}>{p.entryPrice ? usd(p.entryPrice) : "–"}</td>
                <td className={td}>{last ? usd(last) : "–"}</td>
                <td className={`${td} ${plPct == null ? "" : plPct >= 0 ? "text-good" : "text-bad"}`}>
                  {plPct == null ? "–" : `${pct(plPct)} (${usd(Number(lp!.unrealized_pl))})`}
                </td>
                <td className={`${td} text-ink-2`}>
                  {p.stopPrice ? usd(p.stopPrice) : "–"} / {p.takeProfitPrice ? usd(p.takeProfitPrice) : "trail"}
                  {p.contract && <div className="text-xs text-muted">on {p.symbol}</div>}
                </td>
              </tr>
            );
          })}
        </Table>
        {unmanaged.length > 0 && (
          <p className="mt-3 text-xs text-muted">
            Also in the account but not managed by the bot: {unmanaged.map((p) => p.symbol).join(", ")}.
          </p>
        )}
      </Card>

      <Card title="Recent runs">
        <Table head={["Started (ET)", "Trigger", "Status", "Summary"]} empty={recentRuns.length ? undefined : "No runs yet."}>
          {recentRuns.map((r) => {
            const s = (r.summary ?? {}) as { gate?: string; entries?: string[]; exits?: string[]; candidates?: number };
            return (
              <tr key={r.id}>
                <td className={td}>{r.startedAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                <td className={td}>{r.trigger}</td>
                <td className={td}><Badge>{r.status}</Badge></td>
                <td className={`${td} text-ink-2`}>
                  {r.error
                    ? <span className="text-bad">{r.error.slice(0, 160)}</span>
                    : [
                        s.candidates != null && `${s.candidates} candidates`,
                        s.gate && `gated: ${s.gate}`,
                        s.entries?.length && `bought ${s.entries.join(", ")}`,
                        s.exits?.length && `sold ${s.exits.join(", ")}`,
                      ].filter(Boolean).join(" · ") || "–"}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
