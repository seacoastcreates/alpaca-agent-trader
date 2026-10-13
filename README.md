# Rulebook Trader

Rules-based swing trading on an **Alpaca paper account**, with Claude as a risk reviewer.

- **Strategies** (daily bars, run side by side, each toggleable with editable params):
  - *Trend + pullback*: above 50-day SMA, RSI(14) < 35. +6% target / -3% stop / 10-day max hold / exit below trend.
  - *RSI-2 mean reversion*: above 200-day SMA, RSI(2) < 10. Exit above 5-day SMA / 7-day max / -5% stop.
  - *Momentum breakout*: new 20-day high on 1.5x projected volume. 8% trailing stop / -7% hard stop / 30-day max.
- **Risk rules** (global, Claude can't override): position size % of equity, max open positions, max per strategy,
  max new entries per day, daily loss halt, min price, re-entry cooldown, entry time window, kill switch.
- **Claude reviewer** (Haiku 5.5 by default): every new entry candidate gets one review per day against recent
  headlines and price action. In *veto* mode it can block a trade; in *advisory* mode it only records an opinion.
  If a review fails in veto mode, the trade is skipped (fail closed). About $0.0005 per review.
- **Journal**: after each close Claude writes a short daily entry from the day's signals, fills and scoreboard.
- Entries go in as **bracket/OTO orders** (GTC), so stops live at Alpaca even if a tick is missed.
- The app refuses to start trading if `ALPACA_TRADING_URL` isn't the paper API.

## Architecture

```
cron-job.org (every 15 min, market hours) ──► /api/tick ──┐
Vercel Cron (daily 21:30 UTC)            ──► /api/cron/journal
                                                           ▼
Next.js on Vercel ── engine: sync fills → exits → candidates → risk rules → Claude review → orders
        │                     │                                                    │
   Neon Postgres         Alpaca paper API + market data (IEX feed)           Anthropic API
```

Vercel's Hobby plan only allows **daily** crons, so the 15-minute tick comes from cron-job.org (free).

| Piece | Cost |
|---|---|
| Vercel Hobby | $0 |
| Neon free tier | $0 |
| cron-job.org | $0 |
| Claude Haiku 5.5 reviews + journal | ~$0.01-0.03 / day |

## Setup

1. **Neon**: create a project, copy the *pooled* connection string into `.env.local` as `DATABASE_URL`, then
   ```
   npm run db:push
   ```
2. **Local**: fill in `.env.local` (see `.env.example`), then
   ```
   npm run dry-run              # strategies vs live data, no DB, no orders
   npm run dry-run -- --review  # also has Claude review the top candidate
   npm run dev -- -p 3001
   ```
   With `APP_PASSWORD` empty the dashboard is open locally; in production it is locked unless set.
3. **Vercel**: import the GitHub repo, add every variable from `.env.example`, deploy.
   The journal cron in `vercel.json` registers automatically and sends `CRON_SECRET` as a Bearer token.
4. **cron-job.org**: new cron job
   - URL: `https://<your-app>.vercel.app/api/tick`
   - Schedule: every 15 minutes, 9:00-16:59, Mon-Fri, timezone **America/New_York**
   - Advanced → Headers: `Authorization: Bearer <CRON_SECRET>`
   - Ticks outside market hours just sync fills and exit, so the loose window is fine.

## Where things live

- `src/lib/strategies/*` - one file per strategy (`entry`, `bracket`, `exit`, param metadata)
- `src/lib/engine.ts` - the tick: reconcile, exits, candidates, risk gate, review, orders
- `src/lib/agent.ts` - Claude reviewer (structured output) and journal writer
- `src/lib/settings.ts` - risk rules, watchlist, reviewer settings (stored in Postgres, editable in the UI)

Adding a strategy: create a file in `src/lib/strategies/` that exports a `Strategy`, add it to `index.ts`. It appears
in the UI and starts running on the next tick.

## Notes

- Data is Alpaca's free IEX feed. Volume is IEX-only, but the breakout rule compares IEX volume to IEX volume.
- One symbol is owned by one strategy at a time. Positions you open by hand are ignored by the bot.
- Disabling a strategy stops new entries; its open positions keep getting managed until they exit.
