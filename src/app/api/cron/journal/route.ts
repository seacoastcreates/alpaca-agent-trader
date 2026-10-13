import { NextResponse } from "next/server";
import { isCronRequest } from "@/lib/auth";
import { tick } from "@/lib/engine";
import { runJournal } from "@/lib/journal";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Daily Vercel Cron after the close: final sync of fills, then the Claude-written journal.
export async function GET(req: Request) {
  if (!isCronRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    await tick("eod");
    const markdown = await runJournal();
    return NextResponse.json({ ok: true, chars: markdown.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
