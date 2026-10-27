// Google sign-in for the owner. A session is a cookie holding `payload.signature`, where the payload is the signed-in
// email and an expiry, signed with HMAC-SHA256 under AUTH_SECRET. Rotating AUTH_SECRET signs every device out.
// Web Crypto only, so this also runs in the middleware's edge runtime.

export const SESSION_COOKIE = "aat_session";
export const OAUTH_COOKIE = "aat_oauth"; // state + PKCE verifier for a sign-in in progress
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

export const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));

export async function sha256b64url(s: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s))));
}

async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(process.env.AUTH_SECRET ?? ""), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data))));
}

/** Emails allowed to sign in (OWNER_EMAILS, comma-separated). */
export const ownerEmails = () =>
  (process.env.OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Google and the session key are both configured; without them the app is open locally and locked in production. */
const authConfigured = () =>
  !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET && ownerEmails().length);

export async function createSession(email: string) {
  const payload = b64url(enc.encode(JSON.stringify({ email, exp: Date.now() + SESSION_DAYS * 86400_000 })));
  return `${payload}.${await hmac(payload)}`;
}

/** The signed-in owner's email, or null. */
export async function sessionEmail(cookie: string | undefined): Promise<string | null> {
  if (!cookie || !process.env.AUTH_SECRET) return null;
  const [payload, sig] = cookie.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(payload);
  // Constant-time compare
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const { email, exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return typeof email === "string" && exp > Date.now() && ownerEmails().includes(email.toLowerCase()) ? email : null;
  } catch {
    return null;
  }
}

export async function isValidSession(cookie: string | undefined) {
  if (!authConfigured()) return process.env.NODE_ENV !== "production"; // open locally, locked in prod
  return (await sessionEmail(cookie)) != null;
}

/** True when the request carries the owner's session cookie (server components and actions only). */
export async function isOwner() {
  const { cookies } = await import("next/headers");
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** A same-site path to return to after sign-in, so a crafted link can't bounce the owner elsewhere. */
export const safeNext = (next: string | null | undefined) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";

/** Must match an authorized redirect URI on the Google OAuth client. */
export const redirectUri = (origin: string) => `${origin}/api/auth/callback/google`;

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; use the same header from cron-job.org. */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}
