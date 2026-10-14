// Calls the trading loop on Vercel every minute during US market hours.
// Vercel's free plan only allows daily crons; Netlify scheduled functions can run every minute.

export default async () => {
  const url = Netlify.env.get("TICK_URL");
  const secret = Netlify.env.get("CRON_SECRET");
  if (!url || !secret) {
    console.log("TICK_URL or CRON_SECRET not set; skipping");
    return;
  }
  const started = Date.now();
  try {
    // Scheduled functions are capped at 30s; the tick usually takes a few seconds.
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(28_000),
    });
    console.log(`tick ${res.status} in ${Date.now() - started}ms: ${(await res.text()).slice(0, 500)}`);
  } catch (err) {
    console.log(`tick failed after ${Date.now() - started}ms: ${err}`);
  }
};

export const config = {
  // UTC. 13:00-20:59 covers the 9:30-16:00 ET session in both EDT (13:30-20:00) and EST (14:30-21:00);
  // ticks outside the session only sync fills.
  schedule: "* 13-20 * * 1-5",
};
