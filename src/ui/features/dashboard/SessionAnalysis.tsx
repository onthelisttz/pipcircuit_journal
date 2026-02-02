"use client";

import { Session } from "@domain/enums";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";

interface SessionPerformance {
  session: Session;
  count: number;
  profit: number;
  winRate: number;
}

interface SessionAnalysisProps {
  data: SessionPerformance[];
}

const SESSION_LABELS: Record<Session, string> = {
  [Session.Asia]: "Asia",
  [Session.London]: "London",
  [Session.NewYork]: "New York",
  [Session.OutOfSession]: "Out of Session",
};

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
];

export function SessionAnalysis({ data }: SessionAnalysisProps) {
  const radarData = data.map((d) => ({
    session: SESSION_LABELS[d.session] ?? d.session,
    Count: d.count,
    "P&L": Math.round(d.profit * 10) / 10,
    "Win Rate": d.winRate,
  }));

  if (data.length === 0 || data.every((d) => d.count === 0)) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-4">Session Analysis</h3>
        <div className="flex h-48 items-center justify-center text-muted-foreground text-sm">
          No session data
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-medium text-foreground mb-4">Session Analysis</h3>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData}>
            <PolarGrid />
            <PolarAngleAxis
              dataKey="session"
              tick={{ fontSize: 11 }}
            />
            <PolarRadiusAxis
              tick={{ fontSize: 10 }}
              tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v)}
            />
            <Radar
              name="Count"
              dataKey="Count"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            <Radar
              name="P&L"
              dataKey="P&L"
              stroke="var(--chart-2)"
              fill="var(--chart-2)"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            <Radar
              name="Win Rate"
              dataKey="Win Rate"
              stroke="var(--chart-3)"
              fill="var(--chart-3)"
              fillOpacity={0.3}
              strokeWidth={2}
            />
            <Legend />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
