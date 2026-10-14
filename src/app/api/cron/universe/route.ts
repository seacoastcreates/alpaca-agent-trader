import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/auth";
import { db, runs } from "@/lib/db";
import { refreshUniverse } from "@/lib/universe";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Daily pre-market Vercel Cron; only recomputes when the list is older than settings.universe.refreshDays.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Logged as a run so the dashboard shows the cron fired even when no refresh was needed.
  const [run] = await db.insert(runs).values({ trigger: "universe", status: "running" }).returning({ id: runs.id });
  try {
    const r = await refreshUniverse();
    await db.update(runs).set({ status: r.refreshed ? "refreshed" : "up_to_date", finishedAt: new Date(), summary: r })
      .where(eq(runs.id, run.id));
    return NextResponse.json(r);
  } catch (err) {
    await db.update(runs).set({ status: "error", finishedAt: new Date(), error: String(err) }).where(eq(runs.id, run.id));
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
