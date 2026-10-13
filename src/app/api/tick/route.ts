import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/auth";
import { tick } from "@/lib/engine";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Called every 15 minutes during market hours by cron-job.org (Vercel Hobby cron is daily-only).
async function handler(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const r = await tick("cron");
    return NextResponse.json({ status: r.status, gate: r.gate, entries: r.entries, exits: r.exits, candidates: r.candidates.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export { handler as GET, handler as POST };
