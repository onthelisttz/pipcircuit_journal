"use client";

import { useState, useMemo } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

import type { AssetPerformance } from "@application/use-cases/analytics";

type AssetClickType = "count" | "wins" | "losses";

interface AssetAnalysisProps {
  data: AssetPerformance[];
  /** When provided, count/wins/losses cells are clickable; opens panel with that symbol's trades (filtered by type) */
  onCellClick?: (symbol: string, type: AssetClickType, title: string) => void;
}

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

type SortKey =
  | "symbol"
  | "count"
  | "wins"
  | "losses"
  | "profit"
  | "winRate"
  | "avgGainPercent"
  | "avgWin"
  | "avgLoss"
  | "bestTrade"
  | "worstTrade"
  | "avgDurationMs"
  | "fee";
type SortDir = "asc" | "desc";

function formatMoney(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const d = Math.floor(hr / 24);
  if (d >= 1) return `${d}d ${hr % 24}h`;
  if (hr >= 1) return `${hr}h ${min % 60}m`;
  if (min >= 1) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

export function AssetAnalysis({ data, onCellClick }: AssetAnalysisProps) {
  const [sortKey, setSortKey] = useState<SortKey>("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const countData = data.map((d) => ({ name: d.symbol, value: d.count }));
  const profitData = data.map((d) => ({ name: d.symbol, value: d.profit }));
  const winRateData = data.map((d) => ({ name: d.symbol, value: d.winRate }));

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      let aVal: number | string = a[sortKey] ?? 0;
      let bVal: number | string = b[sortKey] ?? 0;
      if (sortKey === "symbol") {
        aVal = String(aVal);
        bVal = String(bVal);
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      const diff = (aVal as number) - (bVal as number);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "symbol" ? "asc" : "desc");
    }
  };

  const SortIcon = ({ column }: { column: SortKey }) => {
    if (sortKey !== column) return <ChevronsUpDown className="ml-1 h-3.5 w-3.5 opacity-50" />;
    return sortDir === "asc" ? (
      <ChevronUp className="ml-1 h-3.5 w-3.5" />
    ) : (
      <ChevronDown className="ml-1 h-3.5 w-3.5" />
    );
  };

  const th = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer select-none px-3 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => handleSort(key)}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon column={key} />
      </span>
    </th>
  );

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

      {/* Donut charts - larger */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <div className="h-56">
          <p className="text-xs text-muted-foreground mb-2">By Count</p>
          <ResponsiveContainer width="100%" height="90%" minHeight={0}>
            <PieChart>
              <Pie
                data={countData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={72}
                paddingAngle={2}
              >
                {countData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                labelStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value?: number) => [value ?? 0, "Trades"]}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "var(--foreground)" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="h-56">
          <p className="text-xs text-muted-foreground mb-2">By P&L</p>
          <ResponsiveContainer width="100%" height="90%" minHeight={0}>
            <PieChart>
              <Pie
                data={profitData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={72}
                paddingAngle={2}
              >
                {profitData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                labelStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value?: number) => {
                  const num = typeof value === "number" ? value : 0;
                  return [`$${num.toFixed(2)}`, "P&L"];
                }}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "var(--foreground)" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="h-56">
          <p className="text-xs text-muted-foreground mb-2">By Win Rate</p>
          <ResponsiveContainer width="100%" height="90%" minHeight={0}>
            <PieChart>
              <Pie
                data={winRateData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={56}
                outerRadius={72}
                paddingAngle={2}
              >
                {winRateData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--popover)",
                  color: "var(--popover-foreground)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
                itemStyle={{ color: "var(--popover-foreground)" }}
                labelStyle={{ color: "var(--popover-foreground)" }}
                formatter={(value?: number) => {
                  const num = typeof value === "number" ? value : 0;
                  return [`${num.toFixed(1)}%`, "Win Rate"];
                }}
              />
              <Legend wrapperStyle={{ fontSize: "11px", color: "var(--foreground)" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sortable asset summary table */}
      <div className="mt-6">
        <p className="text-xs text-muted-foreground mb-2">Asset Summary</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                {th("symbol", "Symbol")}
                {th("count", "Trades")}
                {th("wins", "Wins")}
                {th("losses", "Losses")}
                {th("winRate", "Win %")}
                {th("profit", "Net P&L")}
                {th("avgGainPercent", "Gain %")}
                {th("avgWin", "Avg Win")}
                {th("avgLoss", "Avg Loss")}
                {th("bestTrade", "Best")}
                {th("worstTrade", "Worst")}
                {th("avgDurationMs", "Avg Duration")}
                {th("fee", "Fee (Comm+Swap)")}
              </tr>
            </thead>
            <tbody>
              {sortedData.map((row, i) => (
                <tr
                  key={row.symbol}
                  className={`border-b border-border last:border-0 ${i % 2 === 1 ? "bg-muted/20" : ""}`}
                >
                  <td className="px-3 py-2 font-medium text-foreground">{row.symbol}</td>
                  <td
                    className={`px-3 py-2 text-muted-foreground ${onCellClick && row.count > 0 ? "cursor-pointer hover:bg-muted/40 hover:underline" : ""}`}
                    onClick={onCellClick && row.count > 0 ? () => onCellClick(row.symbol, "count", `${row.symbol} (${row.count} trades)`) : undefined}
                  >
                    {row.count}
                  </td>
                  <td
                    className={`px-3 py-2 text-green-600 dark:text-green-400 ${onCellClick && row.wins > 0 ? "cursor-pointer hover:bg-muted/40 hover:underline" : ""}`}
                    onClick={onCellClick && row.wins > 0 ? () => onCellClick(row.symbol, "wins", `${row.symbol} (${row.wins} wins)`) : undefined}
                  >
                    {row.wins}
                  </td>
                  <td
                    className={`px-3 py-2 text-red-600 dark:text-red-400 ${onCellClick && row.losses > 0 ? "cursor-pointer hover:bg-muted/40 hover:underline" : ""}`}
                    onClick={onCellClick && row.losses > 0 ? () => onCellClick(row.symbol, "losses", `${row.symbol} (${row.losses} losses)`) : undefined}
                  >
                    {row.losses}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.winRate.toFixed(1)}%</td>
                  <td
                    className={`px-3 py-2 font-medium ${
                      row.profit >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatMoney(row.profit)}
                  </td>
                  <td
                    className={`px-3 py-2 font-medium ${
                      row.avgGainPercent >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {row.avgGainPercent === 0 ? "—" : `${row.avgGainPercent.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2 text-green-600 dark:text-green-400">
                    {row.avgWin > 0 ? formatMoney(row.avgWin) : "—"}
                  </td>
                  <td className="px-3 py-2 text-red-600 dark:text-red-400">
                    {row.avgLoss < 0 ? formatMoney(row.avgLoss) : "—"}
                  </td>
                  <td className="px-3 py-2 text-green-600 dark:text-green-400">
                    {row.bestTrade > 0 ? formatMoney(row.bestTrade) : "—"}
                  </td>
                  <td className="px-3 py-2 text-red-600 dark:text-red-400">
                    {row.worstTrade < 0 ? formatMoney(row.worstTrade) : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatDuration(row.avgDurationMs)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatMoney(row.fee)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
