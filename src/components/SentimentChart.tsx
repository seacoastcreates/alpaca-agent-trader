"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });

/** The reader's score (left axis, -1..1) against SPY (right axis) through one session. */
export function SentimentChart({ data, entry }: { data: { t: string; score: number; spy: number | null }[]; entry: number }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="t" tickFormatter={timeLabel} minTickGap={50}
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="score" domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} width={36}
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="spy" orientation="right" domain={["auto", "auto"]} width={52} tickFormatter={(v) => `$${v}`}
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <ReferenceLine yAxisId="score" y={entry} stroke="var(--good)" strokeDasharray="2 4" />
          <ReferenceLine yAxisId="score" y={-entry} stroke="var(--bad)" strokeDasharray="2 4" />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            labelFormatter={(t) => timeLabel(String(t))}
            formatter={(v, name) => [name === "SPY" ? `$${Number(v).toFixed(2)}` : Number(v).toFixed(2), name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="spy" dataKey="spy" name="SPY" stroke="var(--muted)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line yAxisId="score" dataKey="score" name="Sentiment" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
