import { NextResponse, type NextRequest } from "next/server";
import { isValidSession, SESSION_COOKIE } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  if (await isValidSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // Cron routes check CRON_SECRET themselves. /strategies is public (read-only for visitors; its server actions
  // check the session in actions.ts). These are prefix matches: a new route whose path starts with one of
  // them (e.g. "api/tickets") would skip the login check, so keep new route names distinct.
  matcher: ["/((?!login|api/login|api/tick|api/cron|strategies|_next|favicon.ico).*)"],
};
