import { sql } from "drizzle-orm";
import { getPortfolioHistory } from "./alpaca";
import { db } from "./db";
import { RANGES, type EquityPoint, type Range } from "./equity-ranges";

export { RANGES, isRange, type EquityPoint, type Range } from "./equity-ranges";

// Bucketing per range: Daily = every tick of the latest session, Weekly = last reading per hour,
// Monthly / 3-Month = last reading per trading day (stamped at UTC midnight of the ET date, like Alpaca's daily bars).
const SQL: Record<Range, ReturnType<typeof sql>> = {
  "1D": sql`
    select extract(epoch from t) * 1000 as t, equity from equity_snapshots
    where (t at time zone 'America/New_York')::date =
      (select max((t at time zone 'America/New_York')::date) from equity_snapshots)
    order by t`,
  "1W": sql`
    select distinct on (date_trunc('hour', t)) extract(epoch from t) * 1000 as t, equity from equity_snapshots
    where t > now() - interval '7 days' order by date_trunc('hour', t), t desc`,
  "1M": dailySql("31 days"),
  "3M": dailySql("92 days"),
};

function dailySql(span: string) {
  return sql`
    select distinct on (d) extract(epoch from d::timestamp at time zone 'UTC') * 1000 as t, equity
    from (select (t at time zone 'America/New_York')::date as d, t, equity from equity_snapshots
          where t > now() - ${sql.raw(`interval '${span}'`)}) s
    order by d, t desc`;
}

/**
 * Account equity over a range, from the bot's own per-tick readings (the same figure as the dashboard tile).
 * Alpaca's portfolio history fills in the period before the bot started recording; its intraday values
 * don't mark option positions the same way, so it is never mixed in after the first reading.
 */
export async function equityHistory(range: Range): Promise<EquityPoint[]> {
  const res = await db.execute(SQL[range]);
  const ours = (res.rows as { t: string | number; equity: number }[]).map((r) => ({ t: Number(r.t), equity: Number(r.equity) }));
  if (range === "1D") return ours;

  const { period, timeframe } = RANGES[range];
  const firstOurs = ours[0]?.t ?? Infinity;
  const h = await getPortfolioHistory(period, timeframe).catch(() => null);
  const before = (h?.timestamp ?? [])
    .map((t, i) => ({ t: t * 1000, equity: h!.equity[i] }))
    .filter((p): p is EquityPoint => p.equity != null && p.equity > 0 && p.t < firstOurs - (timeframe === "1D" ? 86400_000 : 3600_000) + 1);
  return [...before, ...ours];
}
