"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface PeriodReturn {
  period: string;
  profit: number;
  tradeCount: number;
}

interface ReturnsChartsProps {
  annual: PeriodReturn[];
  monthly: PeriodReturn[];
}

export function ReturnsCharts({ annual, monthly }: ReturnsChartsProps) {
  const annualData = annual.map((a) => ({
    ...a,
    shortLabel: a.period,
  }));

  const monthlyData = monthly.slice(-12).map((m) => ({
    ...m,
    shortLabel: m.period.slice(5),
  }));

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Annual Returns</h3>
        <div className="h-48">
          {annualData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={annualData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Profit"]}
                />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {annualData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.profit >= 0 ? "var(--chart-2)" : "var(--destructive)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Monthly Returns (Last 12)</h3>
        <div className="h-48">
          {monthlyData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: "8px",
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "Profit"]}
                />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {monthlyData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.profit >= 0 ? "var(--chart-3)" : "var(--destructive)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
