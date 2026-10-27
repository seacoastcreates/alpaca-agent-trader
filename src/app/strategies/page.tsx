import { ReadOnlyNote } from "@/components/ReadOnlyNote";
import { StrategyCard } from "@/components/StrategyCard";
import { isOwner } from "@/lib/auth";
import { db, positions } from "@/lib/db";
import { loadStrategies } from "@/lib/engine";
import { strategyStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const [active, stats, ours, owner] = await Promise.all([
    loadStrategies(), strategyStats(), db.select().from(positions), isOwner(),
  ]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Strategies</h1>
        {!owner && <div className="mt-2"><ReadOnlyNote next="/strategies">Viewing read-only.</ReadOnlyNote></div>}
        <p className="mt-1 text-sm text-ink-2">
          Strategies run side by side on daily bars; the intraday rules also read today&apos;s 5 or 15 minute candles. A symbol belongs to one strategy at a time. Exits keep running
          for a disabled strategy&apos;s open positions, so nothing is left unmanaged. Bearish rules buy puts, so they
          only trade when Settings is set to options.
        </p>
      </div>
      {active.map((a) => (
        <StrategyCard
          key={a.def.id}
          id={a.def.id}
          name={a.def.name}
          rules={a.def.rules(a.params)}
          enabled={a.enabled}
          params={a.params}
          meta={a.def.paramMeta}
          stats={stats.find((s) => s.strategyId === a.def.id)}
          openCount={ours.filter((p) => p.strategyId === a.def.id).length}
          canEdit={owner}
        />
      ))}
    </div>
  );
}
