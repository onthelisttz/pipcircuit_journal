"use client";

import { useState, useMemo } from "react";
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

const BAR_CHART_DEFS = (
  <defs>
    <linearGradient id="barWinGradient" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.85} />
      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={1} />
    </linearGradient>
    <linearGradient id="barLossGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="var(--destructive)" stopOpacity={1} />
      <stop offset="100%" stopColor="var(--destructive)" stopOpacity={0.85} />
    </linearGradient>
  </defs>
);

interface PeriodReturn {
  period: string;
  dayOfWeek?: string;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
}

function ReturnsTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: PeriodReturn; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  const period = p.period ?? p.dayOfWeek ?? label ?? "";
  const winning = p.winning ?? 0;
  const losing = p.losing ?? 0;
  const net = p.profit ?? winning + losing;
  const total = Math.abs(winning) + Math.abs(losing);
  const winningPct = total > 0 ? ((winning / total) * 100).toFixed(1) : "0";
  const losingPct = total > 0 ? ((Math.abs(losing) / total) * 100).toFixed(1) : "0";
  const netPct = total > 0 ? ((net / total) * 100).toFixed(1) : "0";

  return (
    <div
      className="rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      style={{ minWidth: "160px" }}
    >
      <p className="font-medium mb-1.5">{period}: {net >= 0 ? "+" : ""}{net.toFixed(2)}$ ({netPct}%)</p>
      <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
        <span className="inline-block w-2 h-2 rounded-sm bg-current" />
        Winning: +{winning.toFixed(2)}$ ({winningPct}%)
      </div>
      <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
        <span className="inline-block w-2 h-2 rounded-sm bg-current" />
        Losing: {losing.toFixed(2)}$ (-{losingPct}%)
      </div>
    </div>
  );
}

interface ReturnsChartsProps {
  annual: PeriodReturn[];
  monthly: PeriodReturn[];
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ReturnsCharts({ annual, monthly }: ReturnsChartsProps) {
  const [selectedYear, setSelectedYear] = useState<string | null>(() => {
    if (monthly.length === 0) return null;
    const last = monthly[monthly.length - 1];
    return last.period.slice(0, 4);
  });

  const availableYears = useMemo(() => {
    const years = new Set(monthly.map((m) => m.period.slice(0, 4)));
    return Array.from(years).sort();
  }, [monthly]);

  const annualData = useMemo(
    () =>
      annual.map((a) => ({
        ...a,
        shortLabel: a.period,
      })),
    [annual]
  );

  const monthlyData = useMemo(() => {
    const filtered = selectedYear
      ? monthly.filter((m) => m.period.startsWith(selectedYear))
      : monthly.slice(-12);
    if (filtered.length === 0) {
      return Array.from({ length: 12 }, (_, i) => ({
        period: `${selectedYear ?? new Date().getFullYear()}-${String(i + 1).padStart(2, "0")}`,
        shortLabel: MONTH_NAMES[i],
        profit: 0,
        tradeCount: 0,
        winning: 0,
        losing: 0,
      }));
    }
    const byMonth = new Map<string, PeriodReturn>();
    for (let i = 1; i <= 12; i++) {
      const key = `${selectedYear ?? ""}-${String(i).padStart(2, "0")}`;
      byMonth.set(key, {
        period: key,
        profit: 0,
        tradeCount: 0,
        winning: 0,
        losing: 0,
      });
    }
    for (const m of filtered) {
      byMonth.set(m.period, m);
    }
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([period, data]) => ({
        ...data,
        shortLabel: MONTH_NAMES[parseInt(period.slice(5), 10) - 1] ?? period.slice(5),
      }));
  }, [monthly, selectedYear]);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Annual Returns</h3>
        <div className="h-56">
          {annualData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={0}>
              <BarChart data={annualData} margin={{ top: 12, right: 12, left: 12, bottom: 12 }} stackOffset="sign" barGap={4}>
                {BAR_CHART_DEFS}
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} strokeOpacity={0.6} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip content={<ReturnsTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.2 }} />
                <Bar dataKey="winning" stackId="stack" fill="url(#barWinGradient)" radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Bar dataKey="losing" stackId="stack" fill="url(#barLossGradient)" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Trade distribution by month</h3>
        <div className="h-56">
          {monthlyData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              No data
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" minHeight={0}>
              <BarChart data={monthlyData} margin={{ top: 12, right: 12, left: 12, bottom: 12 }} stackOffset="sign" barGap={4}>
                {BAR_CHART_DEFS}
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" strokeOpacity={0.6} vertical={false} />
                <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeWidth={1} strokeOpacity={0.6} />
                <XAxis
                  dataKey="shortLabel"
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  angle={-45}
                  textAnchor="end"
                  height={60}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                />
                <Tooltip content={<ReturnsTooltipContent />} cursor={{ fill: "var(--muted)", opacity: 0.2 }} />
                <Bar dataKey="winning" stackId="stack" fill="url(#barWinGradient)" radius={[6, 6, 0, 0]} maxBarSize={36} />
                <Bar dataKey="losing" stackId="stack" fill="url(#barLossGradient)" radius={[6, 6, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        {availableYears.length > 0 && (
          <div className="flex justify-center gap-2 mt-3">
            {availableYears.map((year) => (
              <button
                key={year}
                onClick={() => setSelectedYear(year)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedYear === year
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {year}
              </button>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
