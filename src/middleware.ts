import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

// Pages are public and read-only for visitors; server actions check the owner session themselves (actions.ts).
// Only the API routes below need the owner: backtests are costly to run and exports dump the raw tables.
export async function middleware(req: NextRequest) {
  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/backtest", "/api/export/:path*"],
};
