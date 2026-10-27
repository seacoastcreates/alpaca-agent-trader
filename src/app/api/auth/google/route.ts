import { NextResponse, type NextRequest } from "next/server";
import { OAUTH_COOKIE, randomToken, redirectUri, safeNext, sha256b64url } from "@/lib/auth";

// Starts Google sign-in (authorization code flow with PKCE). The state and verifier wait in a short-lived cookie
// for the callback.
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "GOOGLE_CLIENT_ID is not set" }, { status: 500 });
  const state = randomToken();
  const verifier = randomToken();
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(req.nextUrl.origin),
    response_type: "code",
    scope: "openid email",
    state,
    code_challenge: await sha256b64url(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
  res.cookies.set(OAUTH_COOKIE, JSON.stringify({ state, verifier, next: safeNext(req.nextUrl.searchParams.get("next")) }), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/auth", maxAge: 600,
  });
  return res;
}
