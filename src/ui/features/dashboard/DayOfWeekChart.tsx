"use client";

import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface DayOfWeekReturn {
  dayOfWeek: string;
  dayOrder: number;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
  winningTrades?: number;
  losingTrades?: number;
}

interface DayOfWeekChartProps {
  data: DayOfWeekReturn[];
}

function DayOfWeekTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: DayOfWeekReturn & { shortLabel?: string }; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  const period = p.dayOfWeek ?? label ?? "";
  const winning = p.winning ?? 0;
  const losing = p.losing ?? 0;
  const net = p.profit ?? winning + losing;
  const winCount = p.winningTrades ?? 0;
  const lossCount = p.losingTrades ?? 0;
  const totalTrades = p.tradeCount ?? 0;

  return (
    <div
      className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      style={{ minWidth: "180px" }}
    >
      <p className="font-medium mb-1.5">{period}</p>
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <span className="inline-block w-2 h-2 rounded-sm bg-current" />
        Wins: {winCount} &middot; +{winning.toFixed(2)}$
      </div>
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
        <span className="inline-block w-2 h-2 rounded-sm bg-current" />
        Losses: {lossCount} &middot; {losing.toFixed(2)}$
      </div>
      <div className="mt-1 border-t border-border pt-1">
        <span className="text-xs text-muted-foreground">{totalTrades} trades</span>
        <span
          className={`ml-2 font-semibold ${net >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}
        >
          P&L: {net >= 0 ? "+" : ""}{net.toFixed(2)}$
        </span>
      </div>
    </div>
  );
}

const BAR_CHART_DEFS = (
  <defs>
    <linearGradient id="dayBarWinGradient" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.85} />
      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={1} />
    </linearGradient>
    <linearGradient id="dayBarLossGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--destructive)" stopOpacity={1} />
      <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0.85} />
    </linearGradient>
  </defs>
);

export function DayOfWeekChart({ data }: DayOfWeekChartProps) {
  const chartData = useMemo(
    () =>
      data.map((d) => ({
        ...d,
        shortLabel: d.dayOfWeek.slice(0, 3),
      })),
    [data]
  );

  if (data.length === 0 || data.every((d) => d.tradeCount === 0)) {
    return (
      <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
        <h3 className="mb-2 text-sm font-medium text-foreground sm:mb-4">Gain/Losses by day of week</h3>
        <div className="flex h-52 items-center justify-center text-muted-foreground text-sm sm:h-56">
          No data
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <h3 className="mb-2 text-sm font-medium text-foreground sm:mb-4">Gain/Losses by day of week</h3>
      <div className="h-52 sm:h-56">
        <ResponsiveContainer width="100%" height="100%" minHeight={0}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 4, left: 0, bottom: 4 }}
            stackOffset="sign"
            barGap={4}
          >
            {BAR_CHART_DEFS}
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} strokeOpacity={0.6} />
            <XAxis
              dataKey="shortLabel"
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
              tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
            />
            <Tooltip
              content={<DayOfWeekTooltipContent />}
              cursor={{ fill: "var(--muted)", opacity: 0.2, stroke: "transparent" }}
            />
            <Bar
              dataKey="winning"
              stackId="stack"
              fill="url(#dayBarWinGradient)"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
              activeBar={{ stroke: "transparent", strokeWidth: 0 }}
            />
            <Bar
              dataKey="losing"
              stackId="stack"
              fill="url(#dayBarLossGradient)"
              radius={[6, 6, 0, 0]}
              maxBarSize={36}
              activeBar={{ stroke: "transparent", strokeWidth: 0 }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
