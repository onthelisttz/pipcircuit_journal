"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface AssetPerformance {
  symbol: string;
  count: number;
  profit: number;
  winRate: number;
}

interface AssetAnalysisProps {
  data: AssetPerformance[];
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

export function AssetAnalysis({ data }: AssetAnalysisProps) {
  const countData = data.map((d) => ({ name: d.symbol, value: d.count }));
  const profitData = data.map((d) => ({ name: d.symbol, value: d.profit }));
  const winRateData = data.map((d) => ({ name: d.symbol, value: d.winRate }));

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Asset Analysis</h3>
        <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
          No asset data
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-4">Asset Analysis</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="h-40">
          <p className="text-xs text-muted-foreground mb-2">By Count</p>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={countData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={24}
                outerRadius={36}
                paddingAngle={2}
              >
                {countData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [value, "Trades"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="h-40">
          <p className="text-xs text-muted-foreground mb-2">By P&L</p>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={profitData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={24}
                outerRadius={36}
                paddingAngle={2}
              >
                {profitData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, "P&L"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="h-40">
          <p className="text-xs text-muted-foreground mb-2">By Win Rate</p>
          <ResponsiveContainer width="100%" height="90%">
            <PieChart>
              <Pie
                data={winRateData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={24}
                outerRadius={36}
                paddingAngle={2}
              >
                {winRateData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
