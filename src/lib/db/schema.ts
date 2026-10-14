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
export const positions = pgTable("positions", {
  symbol: text("symbol").primaryKey(),
  strategyId: text("strategy_id").notNull(),
  sector: text("sector"),
  state: text("state").notNull(), // pending | open | closing
  qty: doublePrecision("qty").notNull(),
  entryOrderId: text("entry_order_id").notNull(),
  entryPrice: doublePrecision("entry_price"),
  stopPrice: doublePrecision("stop_price"),
  takeProfitPrice: doublePrecision("take_profit_price"),
  highWater: doublePrecision("high_water"),
  exitReason: text("exit_reason"),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  strategyId: text("strategy_id").notNull(),
  qty: doublePrecision("qty").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price").notNull(),
  pnl: doublePrecision("pnl").notNull(),
  pnlPct: doublePrecision("pnl_pct").notNull(),
  exitReason: text("exit_reason").notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
});

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
