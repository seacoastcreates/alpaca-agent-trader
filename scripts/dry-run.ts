// Evaluate every strategy against live Alpaca data with default settings. No database, no orders.
//   npm run dry-run            -> signals only
//   npm run dry-run -- --review -> also ask Claude to review the top candidate (~$0.001)
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const alpaca = await import("../src/lib/alpaca");
  const { STRATEGIES } = await import("../src/lib/strategies");
  const { DEFAULT_SETTINGS } = await import("../src/lib/settings");
  const { etMinutes } = await import("../src/lib/time");

  const [clock, account] = await Promise.all([alpaca.getClock(), alpaca.getAccount()]);
  console.log(`market open: ${clock.is_open} | equity ${account.equity} | buying power ${account.buying_power}`);

  const watchlist = DEFAULT_SETTINGS.watchlist;
  const bars = await alpaca.getDailyBars(watchlist);
  const counts = watchlist.map((s) => bars[s]?.length ?? 0);
  console.log(`bars: ${watchlist.length} symbols, ${Math.min(...counts)}-${Math.max(...counts)} bars each, last ${bars.SPY?.at(-1)?.t}`);

  const { sessionVolumeShare } = await import("../src/lib/engine");
  const { etDay } = await import("../src/lib/time");
  const elapsed = Math.min(Math.max((etMinutes() - 570) / 390, 0), 1);
  const found: { strategy: string; symbol: string; score: number; indicators: Record<string, number> }[] = [];
  for (const s of STRATEGIES) {
    for (const sym of watchlist) {
      const b = bars[sym];
      if (!b || b.length < 30) continue;
      const sessionFraction = sessionVolumeShare(b, etDay(), clock.is_open, elapsed);
      const sig = s.entry({ bars: b, params: s.defaultParams, sessionFraction });
      if (sig) found.push({ strategy: s.id, symbol: sym, ...sig });
    }
  }
  found.sort((a, b) => b.score - a.score);
  console.log(`\n${found.length} entry signals:`);
  for (const f of found) console.log(`  ${f.symbol.padEnd(6)} ${f.strategy.padEnd(15)} score ${f.score.toFixed(2).padStart(6)}  ${JSON.stringify(f.indicators)}`);

  if (process.argv.includes("--review") && found[0]) {
    const { reviewEntry } = await import("../src/lib/agent");
    const top = found[0];
    const strat = STRATEGIES.find((s) => s.id === top.strategy)!;
    const news = await alpaca.getNews(top.symbol);
    console.log(`\nReviewing ${top.symbol} (${news.length} headlines) with ${DEFAULT_SETTINGS.agent.model}...`);
    const review = await reviewEntry({
      model: DEFAULT_SETTINGS.agent.model, symbol: top.symbol, strategyName: strat.name,
      rules: strat.rules(strat.defaultParams), indicators: top.indicators, bars: bars[top.symbol], news,
    });
    console.log(review);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
