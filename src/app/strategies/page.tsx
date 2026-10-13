import { StrategyCard } from "@/components/StrategyCard";
import { db, positions } from "@/lib/db";
import { loadStrategies } from "@/lib/engine";
import { strategyStats } from "@/lib/stats";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  const [active, stats, ours] = await Promise.all([loadStrategies(), strategyStats(), db.select().from(positions)]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Strategies</h1>
        <p className="mt-1 text-sm text-ink-2">
          Strategies run side by side on daily bars. A symbol belongs to one strategy at a time. Exits keep running
          for a disabled strategy&apos;s open positions, so nothing is left unmanaged.
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
        />
      ))}
    </div>
  );
}
