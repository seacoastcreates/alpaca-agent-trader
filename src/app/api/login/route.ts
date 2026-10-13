import { NextResponse } from "next/server";
import { SESSION_COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: "" }));
  if (!process.env.APP_PASSWORD || password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
