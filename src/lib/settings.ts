import { eq } from "drizzle-orm";
import { db, settings as settingsTable } from "./db";

export type Settings = {
  killSwitch: boolean; // blocks new entries; exits keep running
  watchlist: string[]; // pinned symbols, always scanned
  universe: {
    enabled: boolean; // also scan the auto-ranked most-active stocks
    size: number; // stocks
    etfCount: number; // most-traded ETFs, excluding single-stock funds
    exchanges: string[];
    refreshDays: number;
  };
  risk: {
    maxPositionPct: number; // % of equity per new position
    maxOpenPositions: number;
    maxPositionsPerStrategy: number;
    maxPositionsPerSector: number;
    maxNewEntriesPerDay: number;
    dailyLossLimitPct: number; // halt entries once the day is down this much
    minPrice: number;
    cooldownDays: number; // calendar days before re-entering a symbol after an exit
    entryStartET: string; // "HH:MM" - no entries before (avoid the open)
    entryEndET: string; // "HH:MM" - no entries after
  };
  agent: {
    enabled: boolean;
    mode: "veto" | "advisory"; // veto blocks the trade; advisory only logs the opinion
    model: string;
    maxReviewsPerDay: number;
  };
};

export const DEFAULT_SETTINGS: Settings = {
  killSwitch: false,
  watchlist: [
    "SPY", "QQQ", "IWM", "XLF", "XLE", "XLV", "XLK",
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD",
    "JPM", "BAC", "V", "MA", "UNH", "LLY", "JNJ", "XOM", "CVX",
    "COST", "WMT", "HD", "NFLX", "CRM",
  ],
  universe: { enabled: true, size: 500, etfCount: 50, exchanges: ["NYSE", "NASDAQ"], refreshDays: 7 },
  risk: {
    maxPositionPct: 5,
    maxOpenPositions: 10,
    maxPositionsPerStrategy: 4,
    maxPositionsPerSector: 3,
    maxNewEntriesPerDay: 6,
    dailyLossLimitPct: 2,
    minPrice: 5,
    cooldownDays: 3,
    entryStartET: "10:00",
    entryEndET: "15:45",
  },
  agent: {
    enabled: true,
    mode: "veto",
    model: "claude-haiku-5-5",
    maxReviewsPerDay: 25,
  },
};

export async function getSettings(): Promise<Settings> {
  const row = await db.query.settings.findFirst({ where: eq(settingsTable.id, 1) });
  if (!row) return DEFAULT_SETTINGS;
  // Merge so new fields added to DEFAULT_SETTINGS show up for existing rows.
  const d = row.data;
  return {
    ...DEFAULT_SETTINGS,
    ...d,
    universe: { ...DEFAULT_SETTINGS.universe, ...d.universe },
    risk: { ...DEFAULT_SETTINGS.risk, ...d.risk },
    agent: { ...DEFAULT_SETTINGS.agent, ...d.agent },
  };
}

export async function saveSettings(data: Settings) {
  await db
    .insert(settingsTable)
    .values({ id: 1, data })
    .onConflictDoUpdate({ target: settingsTable.id, set: { data, updatedAt: new Date() } });
}
