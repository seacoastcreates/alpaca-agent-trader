import { NextResponse } from "next/server";
import { equityHistory, isRange } from "@/lib/equity";

export const dynamic = "force-dynamic";

// Session-protected by middleware. /api/equity?range=1D|1W|1M|3M
export async function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range");
  if (!isRange(range)) return NextResponse.json({ error: "range must be 1D, 1W, 1M or 3M" }, { status: 400 });
  try {
    return NextResponse.json({ range, points: await equityHistory(range) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
