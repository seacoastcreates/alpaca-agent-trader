import {
  pgTable, text, integer, serial, boolean, jsonb, timestamp, doublePrecision, index,
} from "drizzle-orm/pg-core";
import type { Settings } from "../settings";

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  data: jsonb("data").$type<Settings>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const strategies = pgTable("strategies", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  params: jsonb("params").$type<Record<string, number | boolean>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  trigger: text("trigger").notNull(),
  status: text("status").notNull(), // running | ok | market_closed | error
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  error: text("error"),
});

export type Review = {
  decision: "approve" | "veto";
  confidence: number;
  reason: string;
  risks: string[];
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export const signals = pgTable(
  "signals",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    day: text("day").notNull(), // trading day, YYYY-MM-DD (ET)
    runId: integer("run_id"),
    symbol: text("symbol").notNull(),
    strategyId: text("strategy_id").notNull(),
    kind: text("kind").notNull(), // entry | exit
    price: doublePrecision("price").notNull(),
    indicators: jsonb("indicators").$type<Record<string, number>>().notNull(),
    // entry: ordered | vetoed | blocked | error ; exit: ordered | error
    status: text("status").notNull(),
    reason: text("reason"),
    review: jsonb("review").$type<Review>(),
    orderId: text("order_id"),
  },
  (t) => [index("signals_day_idx").on(t.day), index("signals_symbol_idx").on(t.symbol)],
);

// Positions the bot owns. Anything else in the Alpaca account is left alone.
// Entry context is captured here while the trade is open and copied into `trades` when it closes.
export const positions = pgTable("positions", {
  symbol: text("symbol").primaryKey(), // underlying ticker (one position per underlying)
  instrument: text("instrument").notNull().default("shares"), // shares | call | put
  contract: text("contract"), // OCC option symbol; the order symbol for options
  multiplier: integer("multiplier").notNull().default(1), // 100 for options
  strike: doublePrecision("strike"),
  expiration: text("expiration"),
  entryDelta: doublePrecision("entry_delta"),
  entryIv: doublePrecision("entry_iv"),
  underlyingEntryPrice: doublePrecision("underlying_entry_price"),
  strategyId: text("strategy_id").notNull(),
  sector: text("sector"),
  state: text("state").notNull(), // pending | open | closing
  qty: doublePrecision("qty").notNull(),
  entryOrderId: text("entry_order_id").notNull(),
  entryPrice: doublePrecision("entry_price"),
  entryFilledAt: timestamp("entry_filled_at", { withTimezone: true }),
  stopPrice: doublePrecision("stop_price"),
  takeProfitPrice: doublePrecision("take_profit_price"),
  highWater: doublePrecision("high_water"), // highest underlying price since entry
  signalId: integer("signal_id"),
  signalAt: timestamp("signal_at", { withTimezone: true }),
  signalPrice: doublePrecision("signal_price"),
  entryIndicators: jsonb("entry_indicators").$type<Record<string, number>>(),
  params: jsonb("params").$type<Record<string, number | boolean>>(),
  review: jsonb("review").$type<Review>(),
  equityAtEntry: doublePrecision("equity_at_entry"),
  appVersion: text("app_version"),
  exitReason: text("exit_reason"),
  exitSignalAt: timestamp("exit_signal_at", { withTimezone: true }),
  exitSignalPrice: doublePrecision("exit_signal_price"),
  exitIndicators: jsonb("exit_indicators").$type<Record<string, number>>(),
  exitOrderId: text("exit_order_id"),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
});

// One row per completed round trip (buy then sell). This is the table to backtest and analyse against.
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    sector: text("sector"),
    side: text("side").notNull().default("long"),
    instrument: text("instrument").notNull().default("shares"), // shares | call | put
    direction: text("direction"), // bullish | bearish (the rule's view of the stock)
    contract: text("contract"),
    strike: doublePrecision("strike"),
    expiration: text("expiration"),
    dteAtEntry: integer("dte_at_entry"),
    multiplier: integer("multiplier").notNull().default(1),
    entryDelta: doublePrecision("entry_delta"),
    entryIv: doublePrecision("entry_iv"),
    underlyingEntryPrice: doublePrecision("underlying_entry_price"),
    underlyingExitPrice: doublePrecision("underlying_exit_price"),
    underlyingReturnPct: doublePrecision("underlying_return_pct"), // the stock's move over the same hold
    // Rule
    strategyId: text("strategy_id").notNull(),
    strategyName: text("strategy_name"),
    params: jsonb("params").$type<Record<string, number | boolean>>(), // strategy parameters at entry
    appVersion: text("app_version"), // git commit that placed the trade
    // Size
    qty: doublePrecision("qty").notNull(), // shares, or contracts for calls
    entryNotional: doublePrecision("entry_notional"),
    equityAtEntry: doublePrecision("equity_at_entry"),
    positionPct: doublePrecision("position_pct"), // entry notional as % of equity
    // Entry
    entrySignalId: integer("entry_signal_id"),
    entrySignalAt: timestamp("entry_signal_at", { withTimezone: true }),
    entrySignalPrice: doublePrecision("entry_signal_price"),
    entryIndicators: jsonb("entry_indicators").$type<Record<string, number>>(),
    entryOrderId: text("entry_order_id"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(), // buy fill time
    entryPrice: doublePrecision("entry_price").notNull(), // buy fill price
    entrySlippagePct: doublePrecision("entry_slippage_pct"), // fill vs signal price, + = paid more
    // Plan
    stopPrice: doublePrecision("stop_price"),
    takeProfitPrice: doublePrecision("take_profit_price"),
    riskPerShare: doublePrecision("risk_per_share"), // entry - stop
    // Exit
    exitReason: text("exit_reason").notNull(), // strategy rule, stop_loss, take_profit, manual_flatten, external
    exitSignalAt: timestamp("exit_signal_at", { withTimezone: true }),
    exitSignalPrice: doublePrecision("exit_signal_price"),
    exitIndicators: jsonb("exit_indicators").$type<Record<string, number>>(),
    exitOrderId: text("exit_order_id"),
    exitOrderType: text("exit_order_type"), // market | stop | limit
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(), // sell fill time
    exitPrice: doublePrecision("exit_price").notNull(), // sell fill price
    exitSlippagePct: doublePrecision("exit_slippage_pct"), // fill vs signal price, + = received less
    // Result
    pnl: doublePrecision("pnl").notNull(),
    pnlPct: doublePrecision("pnl_pct").notNull(),
    rMultiple: doublePrecision("r_multiple"), // pnl per share / risk per share
    holdMinutes: integer("hold_minutes"),
    holdSessions: integer("hold_sessions"), // trading sessions touched (1 = same-day round trip)
    mfePct: doublePrecision("mfe_pct"), // best unrealised gain while held (5-min IEX bars)
    maePct: doublePrecision("mae_pct"), // worst unrealised loss while held
    // Benchmark
    spyEntryPrice: doublePrecision("spy_entry_price"),
    spyExitPrice: doublePrecision("spy_exit_price"),
    spyReturnPct: doublePrecision("spy_return_pct"),
    excessReturnPct: doublePrecision("excess_return_pct"), // pnlPct - spyReturnPct
    // Claude review
    reviewDecision: text("review_decision"),
    reviewConfidence: doublePrecision("review_confidence"),
    reviewReason: text("review_reason"),
    reviewModel: text("review_model"),
    review: jsonb("review").$type<Review>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("trades_strategy_idx").on(t.strategyId), index("trades_closed_idx").on(t.closedAt)],
);

export const journal = pgTable("journal", {
  day: text("day").primaryKey(),
  markdown: text("markdown").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Auto-ranked scan universe (most active stocks by dollar volume), refreshed weekly.
export const universe = pgTable("universe", {
  id: integer("id").primaryKey().default(1),
  symbols: jsonb("symbols").$type<string[]>().notNull(),
  sectors: jsonb("sectors").$type<Record<string, string>>().notNull().default({}),
  meta: jsonb("meta").$type<{
    candidates: number; ranked: number; exchanges: string[]; lookbackDays: number;
    etfs?: string[]; fundsExcluded?: number;
  }>().notNull(),
  computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
});

// Account equity recorded on every market-hours tick (the same number as the dashboard tile), for the chart.
export const equitySnapshots = pgTable("equity_snapshots", {
  t: timestamp("t", { withTimezone: true }).primaryKey().defaultNow(),
  equity: doublePrecision("equity").notNull(),
  lastEquity: doublePrecision("last_equity"),
});
