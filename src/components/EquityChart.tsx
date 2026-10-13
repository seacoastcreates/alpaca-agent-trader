"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type EquityPoint = { date: string; equity: number };

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function EquityChart({ data }: { data: EquityPoint[] }) {
  if (data.length < 2) return <p className="text-sm text-muted">Equity history appears after a couple of trading days.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis
            tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} width={72}
            domain={["auto", "auto"]} tickFormatter={fmt}
          />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeDasharray: "3 3" }}
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, color: "var(--ink)" }}
            formatter={(v) => [fmt(Number(v)), "Equity"]}
          />
          <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={2} fill="url(#eq)" activeDot={{ r: 4 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
