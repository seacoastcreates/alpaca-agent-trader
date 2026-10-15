// Shared by the server (Alpaca query) and the chart (tabs, labels); no server imports here.
export const RANGES = {
  "1D": { label: "Daily", period: "1D", timeframe: "5Min" },
  "1W": { label: "Weekly", period: "1W", timeframe: "1H" },
  "1M": { label: "Monthly", period: "1M", timeframe: "1D" },
  "3M": { label: "3-Month", period: "3M", timeframe: "1D" },
} as const;
export type Range = keyof typeof RANGES;
export const isRange = (r: unknown): r is Range => typeof r === "string" && r in RANGES;

export type EquityPoint = { t: number; equity: number }; // t = unix ms
