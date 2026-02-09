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

interface DrawdownPoint {
  date: string;
  drawdown: number;
  peak: number;
  equity: number;
}

interface DrawdownChartProps {
  data: DrawdownPoint[];
}

export function DrawdownChart({ data }: DrawdownChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground">
        No drawdown data
      </div>
    );
  }

  const chartData = data.map((d) => ({
    ...d,
    displayDate: format(new Date(d.date), "MMM d"),
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-4">Drawdown</h3>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%" minHeight={0}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="drawdownGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--destructive)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="displayDate"
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
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
              formatter={(value: number) => [`$${value.toFixed(2)}`, "Drawdown"]}
            />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke="var(--destructive)"
              strokeWidth={2}
              fill="url(#drawdownGradient)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
