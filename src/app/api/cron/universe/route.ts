import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/auth";
import { refreshUniverse } from "@/lib/universe";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Daily pre-market Vercel Cron; only recomputes when the list is older than settings.universe.refreshDays.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await refreshUniverse());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
