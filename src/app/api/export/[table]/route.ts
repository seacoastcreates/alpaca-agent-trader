import { asc, getTableColumns } from "drizzle-orm";
import { db, signals, trades } from "@/lib/db";

export const dynamic = "force-dynamic";

// Session-protected by middleware. /api/export/trades and /api/export/signals download CSVs.
const TABLES = {
  trades: { cols: Object.keys(getTableColumns(trades)), load: () => db.select().from(trades).orderBy(asc(trades.closedAt)) },
  signals: { cols: Object.keys(getTableColumns(signals)), load: () => db.select().from(signals).orderBy(asc(signals.createdAt)) },
};

function cell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(_req: Request, { params }: { params: Promise<{ table: string }> }) {
  const { table } = await params;
  const spec = TABLES[table as keyof typeof TABLES];
  if (!spec) return new Response("Unknown table", { status: 404 });
  const rows = (await spec.load()) as Record<string, unknown>[];
  const cols = spec.cols;
  const csv = [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
