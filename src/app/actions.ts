"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, strategies } from "@/lib/db";
import { flattenAll, tick } from "@/lib/engine";
import { runJournal } from "@/lib/journal";
import { getSettings, saveSettings } from "@/lib/settings";
import { refreshUniverse } from "@/lib/universe";
import { STRATEGY_BY_ID } from "@/lib/strategies";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runTickNow() {
  try {
    const r = await tick("manual");
    revalidatePath("/", "layout");
    return { ok: true as const, status: r.status, gate: r.gate, entries: r.entries, exits: r.exits, candidates: r.candidates.length };
  } catch (e) {
    return { ok: false as const, error: errMsg(e) };
  }
}

export async function previewSignals() {
  try {
    const r = await tick("preview", { dryRun: true });
    return { ok: true as const, gate: r.gate, candidates: r.candidates, exits: r.exits };
  } catch (e) {
    return { ok: false as const, error: errMsg(e) };
  }
}

export async function setKillSwitch(on: boolean) {
  const s = await getSettings();
  await saveSettings({ ...s, killSwitch: on });
  revalidatePath("/", "layout");
}

export async function flatten() {
  try {
    const closed = await flattenAll();
    revalidatePath("/", "layout");
    return { ok: true as const, closed };
  } catch (e) {
    return { ok: false as const, error: errMsg(e) };
  }
}

export async function updateStrategy(id: string, enabled: boolean, params: Record<string, number | boolean>) {
  const def = STRATEGY_BY_ID[id];
  if (!def) throw new Error(`Unknown strategy ${id}`);
  const clean: Record<string, number | boolean> = {};
  for (const [k, meta] of Object.entries(def.paramMeta)) {
    const v = params[k] ?? def.defaultParams[k];
    if (typeof def.defaultParams[k] === "boolean") clean[k] = Boolean(v);
    else {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new Error(`${meta.label} must be a number`);
      clean[k] = Math.min(meta.max ?? Infinity, Math.max(meta.min ?? -Infinity, n));
    }
  }
  await db.insert(strategies).values({ id, enabled, params: clean })
    .onConflictDoUpdate({ target: strategies.id, set: { enabled, params: clean, updatedAt: new Date() } });
  revalidatePath("/strategies");
}

export async function resetStrategy(id: string) {
  const def = STRATEGY_BY_ID[id];
  await db.update(strategies).set({ params: def.defaultParams, updatedAt: new Date() }).where(eq(strategies.id, id));
  revalidatePath("/strategies");
}

const SettingsSchema = z.object({
  killSwitch: z.boolean(),
  instrument: z.enum(["shares", "options"]),
  options: z.object({
    premiumPct: z.number().min(0.1).max(25),
    minDte: z.number().int().min(1).max(365),
    maxDte: z.number().int().min(1).max(730),
    targetDte: z.number().int().min(1).max(730),
    minDelta: z.number().min(0.05).max(0.99),
    maxDelta: z.number().min(0.05).max(0.99),
    targetDelta: z.number().min(0.05).max(0.99),
    minOpenInterest: z.number().int().min(0),
    maxSpreadPct: z.number().min(0.5).max(100),
    premiumStopPct: z.number().min(5).max(100),
    premiumTargetPct: z.number().min(5).max(1000),
    closeAtDte: z.number().int().min(0).max(60),
    entryTimeoutMin: z.number().int().min(1).max(120),
  }),
  watchlist: z.array(z.string().regex(/^[A-Z.]{1,6}$/)).max(200),
  universe: z.object({
    enabled: z.boolean(),
    size: z.number().int().min(10).max(1000),
    etfCount: z.number().int().min(0).max(200),
    exchanges: z.array(z.enum(["NYSE", "NASDAQ", "ARCA", "AMEX", "BATS"])).min(1),
    refreshDays: z.number().int().min(1).max(90),
  }),
  risk: z.object({
    maxPositionPct: z.number().min(0.1).max(25),
    maxOpenPositions: z.number().int().min(1).max(50),
    maxPositionsPerStrategy: z.number().int().min(1).max(50),
    maxPositionsPerSector: z.number().int().min(1).max(50),
    maxNewEntriesPerDay: z.number().int().min(0).max(50),
    dailyLossLimitPct: z.number().min(0.1).max(20),
    minPrice: z.number().min(0).max(1000),
    cooldownDays: z.number().int().min(0).max(30),
    entryStartET: z.string().regex(/^\d{2}:\d{2}$/),
    entryEndET: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  agent: z.object({
    enabled: z.boolean(),
    mode: z.enum(["veto", "advisory"]),
    model: z.string().min(1),
    maxReviewsPerDay: z.number().int().min(0).max(500),
  }),
});

export async function saveSettingsAction(input: unknown) {
  const parsed = SettingsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  await saveSettings(parsed.data);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function generateJournal() {
  try {
    await runJournal();
    revalidatePath("/journal");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: errMsg(e) };
  }
}

export async function refreshUniverseNow() {
  try {
    const r = await refreshUniverse({ force: true });
    revalidatePath("/settings");
    return { ok: true as const, count: r.count };
  } catch (e) {
    return { ok: false as const, error: errMsg(e) };
  }
}
