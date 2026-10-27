export const SESSION_COOKIE = "aat_session";

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const sessionToken = () => sha256(`aat:${process.env.APP_PASSWORD ?? ""}`);

export async function isValidSession(cookie: string | undefined) {
  if (!process.env.APP_PASSWORD) return process.env.NODE_ENV !== "production"; // open locally, locked in prod
  return !!cookie && cookie === (await sessionToken());
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; use the same header from cron-job.org. */
export function isCronRequest(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

/** True when the request carries the owner's session cookie (server components and actions only). */
export async function isOwner() {
  const { cookies } = await import("next/headers");
  return isValidSession((await cookies()).get(SESSION_COOKIE)?.value);
}
