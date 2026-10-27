import { NextResponse, type NextRequest } from "next/server";
import { createSession, OAUTH_COOKIE, ownerEmails, redirectUri, safeNext, SESSION_COOKIE, SESSION_DAYS } from "@/lib/auth";

// Google redirects here with a code. Exchange it (with the PKCE verifier) for an ID token straight from Google's
// token endpoint over TLS, which is what makes its claims trustworthy, then let in only the owner's verified email.
export async function GET(req: NextRequest) {
  const fail = (error: string) => {
    const url = new URL("/login", req.nextUrl.origin);
    url.searchParams.set("error", error);
    const res = NextResponse.redirect(url);
    res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
    return res;
  };

  let pending: { state?: string; verifier?: string; next?: string } = {};
  try {
    pending = JSON.parse(req.cookies.get(OAUTH_COOKIE)?.value ?? "{}");
  } catch {}
  const code = req.nextUrl.searchParams.get("code");
  if (!code || !pending.state || req.nextUrl.searchParams.get("state") !== pending.state || !pending.verifier) {
    return fail("expired");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri(req.nextUrl.origin),
      grant_type: "authorization_code",
      code_verifier: pending.verifier,
    }),
  });
  if (!tokenRes.ok) return fail("google");
  const { id_token } = (await tokenRes.json()) as { id_token?: string };
  let claims: { iss?: string; aud?: string; email?: string; email_verified?: boolean; exp?: number } = {};
  try {
    const part = id_token!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch {
    return fail("google");
  }
  const email = claims.email?.toLowerCase();
  const valid =
    ["https://accounts.google.com", "accounts.google.com"].includes(claims.iss ?? "") &&
    claims.aud === process.env.GOOGLE_CLIENT_ID &&
    (claims.exp ?? 0) * 1000 > Date.now() &&
    claims.email_verified === true &&
    !!email && ownerEmails().includes(email);
  if (!valid) return fail("not_allowed");

  const res = NextResponse.redirect(new URL(safeNext(pending.next), req.nextUrl.origin));
  res.cookies.set(SESSION_COOKIE, await createSession(email!), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_DAYS * 86400,
  });
  res.cookies.delete({ name: OAUTH_COOKIE, path: "/api/auth" });
  return res;
}
