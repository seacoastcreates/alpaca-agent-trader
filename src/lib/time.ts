const ET = "America/New_York";

/** YYYY-MM-DD in Eastern time. */
export function etDay(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ET }).format(d);
}

/** Minutes since midnight in Eastern time. */
export function etMinutes(d: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === "hour")!.value);
  const m = Number(parts.find((p) => p.type === "minute")!.value);
  return h * 60 + m;
}

export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
