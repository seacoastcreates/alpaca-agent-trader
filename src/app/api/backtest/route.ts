import { NextResponse } from "next/server";
import { z } from "zod";
import { PERIODS, runBacktest, type Period } from "@/lib/backtest";
import { loadStrategies } from "@/lib/engine";
import { getSettings } from "@/lib/settings";
import { scanList } from "@/lib/universe";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Body = z.object({
  strategies: z.array(z.string()).min(1),
  period: z.enum(Object.keys(PERIODS) as [Period, ...Period[]]),
  universe: z.enum(["watchlist", "full"]),
  positionPct: z.number().min(0.5).max(100),
  maxPositions: z.number().int().min(1).max(50),
  slippageBps: z.number().min(0).max(100),
});

// Session-protected by middleware. Runs the strategies with their saved params against historical daily bars.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const body = parsed.data;
  try {
    const [settings, active] = await Promise.all([getSettings(), loadStrategies()]);
    const symbols = body.universe === "full" ? (await scanList(settings)).symbols : settings.watchlist;
    const result = await runBacktest({
      strategies: active.filter((a) => !a.def.intervalMin && body.strategies.includes(a.def.id)).map((a) => ({ id: a.def.id, params: a.params })),
      symbols,
      period: body.period,
      options: {
        startEquity: 100_000,
        positionPct: body.positionPct,
        maxPositions: body.maxPositions,
        minPrice: settings.risk.minPrice,
        cooldownDays: settings.risk.cooldownDays,
        slippageBps: body.slippageBps,
      },
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
