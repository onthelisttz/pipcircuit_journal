"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format } from "date-fns";

interface EquityPoint {
  date: string;
  equity: number;
  cumulativeProfit: number;
}

interface EquityCurveChartProps {
  data: EquityPoint[];
}

export function EquityCurveChart({ data }: EquityCurveChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        No equity data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    displayDate: format(new Date(d.date), "MMM d"),
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground sm:mb-4">Equity Curve</h3>
      <div className="h-52 sm:h-64">
        <ResponsiveContainer width="100%" height="100%" minHeight={0}>
          <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
              width={40}
              tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                color: "var(--popover-foreground)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
              itemStyle={{ color: "var(--popover-foreground)" }}
              labelStyle={{ color: "var(--popover-foreground)" }}
              cursor={false}
              labelFormatter={(_, payload) =>
                payload?.[0]?.payload?.displayDate ?? ""
              }
              formatter={(value?: number) => {
                const num = typeof value === "number" ? value : 0;
                return [`$${num.toFixed(2)}`, "Equity"];
              }}
            />
            <Area
              type="monotone"
              dataKey="equity"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="url(#equityGradient)"
              activeDot={{
                r: 4,
                fill: "var(--chart-1)",
                stroke: "transparent",
                strokeWidth: 0,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
