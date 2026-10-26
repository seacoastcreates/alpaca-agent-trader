"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const dateLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" });

/** Account vs benchmark, both as % return since the first day. */
export function ReturnChart({ data }: { data: { date: string; account: number; SPY?: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={dateLabel} minTickGap={40}
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v) => `${v}%`} width={48} domain={["auto", "auto"]}
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(d) => dateLabel(String(d))}
            formatter={(v, name) => [`${Number(v) >= 0 ? "+" : ""}${Number(v).toFixed(2)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="SPY" name="SPY" stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="account" name="Your account" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
