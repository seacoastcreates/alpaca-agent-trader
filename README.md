# Rulebook Trader

Rules-based swing trading on an **Alpaca paper account**, with Claude as a risk reviewer.

- **Strategies** (daily bars, run side by side, each toggleable with editable params):
  - *Trend + pullback*: above 50-day SMA, RSI(14) < 35. +6% target / -3% stop / 10-day max hold / exit below trend.
  - *RSI-2 mean reversion*: above 200-day SMA, RSI(2) < 10. Exit above 5-day SMA / 7-day max / -5% stop.
  - *Momentum breakout*: new 20-day high on 1.5x projected volume. 8% trailing stop / -7% hard stop / 30-day max.
- **Universe**: the top 500 NYSE + NASDAQ stocks and the top 50 ETFs by 30-day average dollar volume,
  re-ranked weekly before the open, plus a pinned list that is always scanned. Single-stock ETFs (e.g.
  "Daily TSLA Bull 2X") are excluded: a stock ticker in the name plus a leveraged/inverse/income cue.
  Completed daily bars are cached in memory per day, so each 1-minute tick only fetches snapshots.
- **Bearish rules** (puts): mirror images of the three bullish rules: *Downtrend + rally* (below 50-day SMA,
  RSI(14) > 65), *RSI-2 overbought* (below 200-day SMA, RSI(2) > 90) and *Momentum breakdown* (new 20-day low on
  1.5x volume). They only trade in options mode. A symbol with both bullish and bearish signals is skipped.
- **Options** (Settings -> What a buy signal buys): bullish signals buy calls, bearish signals buy puts. Each
  signal buys the contract nearest |delta| 0.65 and ~45 days to
  expiry that passes open-interest and spread filters and fits the premium budget (default 5% of equity), with a
  limit order at the bid-ask midpoint (cancelled if unfilled after 10 min). Calls have no broker-held stops, so every tick sells
  on the strategy's stop/target level on the stock, -50% / +100% on the premium, 10 days to expiry, or the
  strategy's exit rule (limit at the bid, re-priced every 2 min). Option quotes use Alpaca's free indicative feed.
- **Risk rules** (global, Claude can't override): position size % of equity, max open positions, max per strategy,
  max per sector (Nasdaq screener sectors, stored with the universe; pinned ETFs mapped by hand),
  max new entries per day, daily loss halt, min price, re-entry cooldown, entry time window, kill switch.
- **Claude reviewer** (Haiku 5.5 by default): every new entry candidate gets one review per day against recent
  headlines and price action. In *veto* mode it can block a trade; in *advisory* mode it only records an opinion.
  If a review fails in veto mode, the trade is skipped (fail closed). About $0.0005 per review.
- **Journal**: after each close Claude writes a short daily entry from the day's signals, fills and scoreboard.
- Entries go in as **bracket/OTO orders** (GTC), so stops live at Alpaca even if a tick is missed.
- The app refuses to start trading if `ALPACA_TRADING_URL` isn't the paper API.

## Architecture

```
Netlify scheduled fn (every minute, 13:00-20:59 UTC weekdays) ──► /api/tick ──┐
Vercel Cron (daily 11:00 UTC)            ──► /api/cron/universe (re-rank if older than 7 days)
Vercel Cron (daily 22:15 UTC)            ──► /api/cron/journal
                                                           ▼
Next.js on Vercel ── engine: sync fills → exits → candidates → risk rules → Claude review → orders
        │                     │                                                    │
   Neon Postgres         Alpaca paper API + market data (IEX feed)           Anthropic API
```

Vercel's Hobby plan only allows daily crons, so the per-minute tick comes from a tiny Netlify scheduled function in
`pinger/` (site `rulebook-trader-pinger`). Vercel Cron only runs the daily journal.

| Piece | Cost |
|---|---|
| Vercel Hobby | $0 |
| Netlify (pinger) | $0 |
| Neon free tier | $0 |
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
   npm run universe             # rank and save the top-500 universe now
   npm run dev -- -p 3001
   ```
   With `APP_PASSWORD` empty the dashboard is open locally; in production it is locked unless set.
3. **Vercel**: import the GitHub repo, add every variable from `.env.example`, deploy.
   The journal cron in `vercel.json` registers automatically and Vercel sends `CRON_SECRET` as a Bearer token.
4. **Pinger**: on the Netlify site, set `TICK_URL=https://<your-app>.vercel.app/api/tick` and the same `CRON_SECRET`
   (scope: Functions), then redeploy. See `pinger/README.md`.

## Trade log and backtesting

Every completed round trip is one row in the `trades` table (Neon Postgres). Download it as CSV from
**Activity -> Trades CSV**, or query it in the Neon SQL editor. Each row has:

| Group | Columns |
|---|---|
| Rule | `strategy_id`, `strategy_name`, `params` (strategy settings at entry), `app_version` (git commit) |
| What | `symbol`, `sector`, `side`, `qty`, `entry_notional`, `equity_at_entry`, `position_pct` |
| Entry | `entry_signal_at` / `entry_signal_price` (rule fired), `opened_at` / `entry_price` (buy fill), `entry_slippage_pct`, `entry_indicators` |
| Plan | `stop_price`, `take_profit_price`, `risk_per_share` |
| Exit | `exit_reason`, `exit_signal_at` / `exit_signal_price`, `closed_at` / `exit_price` (sell fill), `exit_order_type`, `exit_slippage_pct`, `exit_indicators` |
| Result | `pnl`, `pnl_pct`, `r_multiple`, `hold_minutes`, `hold_sessions`, `mfe_pct` / `mae_pct` (best / worst while held) |
| Benchmark | `spy_entry_price`, `spy_exit_price`, `spy_return_pct`, `excess_return_pct` |
| Options | `instrument` (shares/call/put), `direction`, `contract`, `strike`, `expiration`, `dte_at_entry`, `multiplier`, `entry_delta`, `entry_iv`, `underlying_entry_price` / `underlying_exit_price` / `underlying_return_pct` |
| Claude | `review_decision`, `review_confidence`, `review_reason`, `review_model`, `review` |

Every decision that did *not* become a trade (blocked by a risk rule, vetoed by Claude) is in `signals`
(**Signals CSV**), with the indicators at the time.

```sql
-- Scoreboard by rule
select strategy_id, count(*) trades, round(avg((pnl > 0)::int) * 100, 1) win_rate,
       round(avg(pnl_pct)::numeric, 2) avg_pct, round(avg(r_multiple)::numeric, 2) avg_r,
       round(sum(pnl)::numeric, 2) total_pnl, round(avg(excess_return_pct)::numeric, 2) avg_vs_spy
from trades group by 1 order by total_pnl desc;

-- Do the targets leave money on the table? (best unrealised gain vs what was kept)
select strategy_id, exit_reason, count(*), round(avg(mfe_pct)::numeric, 2) avg_best, round(avg(pnl_pct)::numeric, 2) avg_kept
from trades group by 1, 2 order by 1, 2;

-- Did a parameter change help? (params are snapshotted per trade)
select params->>'rsiEntry' rsi_entry, count(*), round(avg(pnl_pct)::numeric, 2) avg_pct
from trades where strategy_id = 'trend_pullback' group by 1;

-- Is Claude's confidence predictive?
select width_bucket(review_confidence, 0, 1, 4) bucket, count(*), round(avg(pnl_pct)::numeric, 2) avg_pct
from trades where review_decision = 'approve' group by 1 order by 1;
```

`mfe_pct`/`mae_pct` and hold sessions come from 5-minute IEX bars; SPY prices are the 1-minute bar at each fill.

## Performance page

**Performance** starts with the bot's real record on this account, from the `trades` and `signals` tables and the
equity history: P&L, win rate, profit factor and account vs SPY; breakdowns by strategy, entry hour, exit reason,
hold and instrument; whether the stock moved the rule's way vs whether the trade made money (signal vs options);
how Claude-vetoed signals moved over the next 3 sessions compared with approved ones; what the risk rules blocked;
and a short list of findings generated from those numbers (`src/lib/performance.ts`, no model call).

Below it, the strategy backtest replays each strategy's own `entry` / `bracket` / `exit` code, with its saved params, over past daily
bars (6 months to 3 years, pinned watchlist or the full scan list) and shows a return chart vs SPY buy & hold, a
scoreboard (return, max drawdown, win rate, avg trade, profit factor, Sharpe, hold time, share invested) and the
trade list. Each strategy runs as its own $100k account with the position size / max positions you pick, plus the
min price and cooldown from Settings.

Fill model: signals fill at the day's close; stops and targets fill at their level when the day's range touches them
(stop first if both, at the open on a gap); strategy exit rules fill at the close. Bearish rules are scored as a
short of the stock, not puts. The Claude reviewer, sector caps and options are left out, and today's symbol list is
used for the whole period (survivorship bias). Code: `src/lib/backtest.ts`, `/api/backtest`.

## Where things live

- `src/lib/strategies/*` - one file per strategy (`entry`, `bracket`, `exit`, param metadata)
- `src/lib/engine.ts` - the tick: reconcile, exits, candidates, risk gate, review, orders
- `src/lib/agent.ts` - Claude reviewer (structured output) and journal writer
- `src/lib/universe.ts` - most-active ranking and the scan list
- `src/lib/trades.ts` - builds the `trades` row when a position closes
- `src/lib/settings.ts` - risk rules, watchlist, reviewer settings (stored in Postgres, editable in the UI)

Adding a strategy: create a file in `src/lib/strategies/` that exports a `Strategy`, add it to `index.ts`. It appears
in the UI and starts running on the next tick.

## Notes

- Data is Alpaca's free IEX feed. Volume is IEX-only, but the breakout rule compares IEX volume to IEX volume.
- One symbol is owned by one strategy at a time. Positions you open by hand are ignored by the bot.
- Disabling a strategy stops new entries; its open positions keep getting managed until they exit.
