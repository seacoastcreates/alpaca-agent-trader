import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

// POST only, so a link or image elsewhere can't sign the owner out.
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/strategies", req.nextUrl.origin), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
