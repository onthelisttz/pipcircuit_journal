"use client";

import { useMemo, useState, useEffect } from "react";
import { format } from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  BarChart3,
  FileText,
  Tag,
  TrendingUp,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type { Trade } from "@domain/entities";
import { useTradePanel } from "@ui/providers";
import { useTrade } from "@ui/hooks";
import { TradePanelDetailTabs } from "./TradePanelDetailTabs";
import { volumeToLots } from "@lib/pnl-estimate";

interface TradePanelContentProps {
  trades: Trade[];
  isLoading: boolean;
  onClose: () => void;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

export function TradePanelContent({
  trades,
  isLoading,
  onClose,
}: TradePanelContentProps) {
  const { selectedTradeId, setSelectedTradeId } = useTradePanel();
  const [activeTab, setActiveTab] = useState<"details" | "journal" | "tags" | "chart">("details");
  type SortCol = "name" | "type" | "size" | "pnl" | "date";
  const [sortCol, setSortCol] = useState<SortCol>("date");
  const [sortAsc, setSortAsc] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);

  const summary = useMemo(() => {
    const total = trades.length;
    const totalProfit = trades.reduce((s, t) => s + (t.netProfit ?? t.grossProfit ?? 0), 0);
    const wins = trades.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) >= 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    return { total, totalProfit, wins, winRate };
  }, [trades]);

  const sortedTrades = useMemo(() => {
    const arr = [...trades];
    const mult = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "name":
          cmp = (a.symbol ?? "").localeCompare(b.symbol ?? "");
          break;
        case "type":
          cmp = (a.direction ?? "").localeCompare(b.direction ?? "");
          break;
        case "size": {
          const lotsA = volumeToLots(a.volume ?? 0, a.symbol ?? "");
          const lotsB = volumeToLots(b.volume ?? 0, b.symbol ?? "");
          cmp = lotsA - lotsB;
          break;
        }
        case "pnl": {
          const pA = a.netProfit ?? a.grossProfit ?? 0;
          const pB = b.netProfit ?? b.grossProfit ?? 0;
          cmp = pA - pB;
          break;
        }
        case "date":
        default: {
          const tA = new Date(a.closeTime ?? a.openTime ?? 0).getTime();
          const tB = new Date(b.closeTime ?? b.openTime ?? 0).getTime();
          cmp = tA - tB;
          break;
        }
      }
      return mult * cmp;
    });
    return arr;
  }, [trades, sortCol, sortAsc]);

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc((a) => !a);
    else {
      setSortCol(col);
      setSortAsc(col === "date" || col === "pnl" ? false : true);
    }
  };

  const selectedIndex = useMemo(
    () => trades.findIndex((t) => t.id === selectedTradeId),
    [trades, selectedTradeId]
  );

  useEffect(() => {
    if (trades.length === 0) return;
    const hasValidSelection =
      selectedTradeId != null && trades.some((t) => t.id === selectedTradeId);
    if (!hasValidSelection) {
      setSelectedTradeId(trades[0].id ?? null);
    }
  }, [trades, selectedTradeId, setSelectedTradeId]);

  const goPrev = () => {
    if (selectedIndex > 0) setSelectedTradeId(trades[selectedIndex - 1].id ?? null);
  };
  const goNext = () => {
    if (selectedIndex >= 0 && selectedIndex < trades.length - 1)
      setSelectedTradeId(trades[selectedIndex + 1].id ?? null);
  };

  const tabs = [
    { id: "details" as const, label: "Details", icon: BarChart3 },
    { id: "journal" as const, label: "Journal", icon: FileText },
    { id: "tags" as const, label: "Tags", icon: Tag },
    { id: "chart" as const, label: "Chart", icon: TrendingUp },
  ];

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Summary */}
      <div className="shrink-0 border-b border-border px-4 py-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-muted-foreground">
            {summary.total} trade{summary.total !== 1 ? "s" : ""}
          </span>
          <span
            className={
              summary.totalProfit >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-destructive"
            }
          >
            {formatProfit(summary.totalProfit)}
          </span>
          <span className="text-muted-foreground">
            {summary.winRate.toFixed(0)}% win rate
          </span>
        </div>
      </div>

      {/* Trade list - sortable table (collapsible) */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-4 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            Trades
          </span>
          <button
            type="button"
            onClick={() => setListCollapsed((v) => !v)}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {listCollapsed ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">
              {listCollapsed ? "Show trade list" : "Hide trade list"}
            </span>
          </button>
        </div>
        {listCollapsed ? (
          <div className="px-4 pb-2">
            {selectedIndex >= 0 && trades[selectedIndex] ? (
              <div className="flex items-center justify-between text-xs">
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {trades[selectedIndex].symbol}
                  </span>
                  <span className="text-muted-foreground">
                    {trades[selectedIndex].direction} ·{" "}
                    {volumeToLots(trades[selectedIndex].volume ?? 0, trades[selectedIndex].symbol ?? "").toFixed(2)}{" "}
                    lots
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={`block tabular-nums ${
                      (trades[selectedIndex].netProfit ?? trades[selectedIndex].grossProfit ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {formatProfit(
                      trades[selectedIndex].netProfit ?? trades[selectedIndex].grossProfit ?? 0
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {format(
                      new Date(trades[selectedIndex].closeTime ?? trades[selectedIndex].openTime ?? 0),
                      "MMM d HH:mm"
                    )}
                  </span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No trade selected</p>
            )}
          </div>
        ) : (
          <div className="max-h-40 overflow-y-auto">
            {trades.length === 0 ? (
              <p className="px-4 py-4 text-center text-sm text-muted-foreground">
                No trades
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                  <tr>
                    <th className="px-2 py-1.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggleSort("name")}
                        className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Name
                        {sortCol === "name" ? (
                          sortAsc ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggleSort("type")}
                        className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Type
                        {sortCol === "type" ? (
                          sortAsc ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggleSort("size")}
                        className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Size
                        {sortCol === "size" ? (
                          sortAsc ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="px-2 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => toggleSort("pnl")}
                        className="ml-auto flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        P/L
                        {sortCol === "pnl" ? (
                          sortAsc ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </th>
                    <th className="px-2 py-1.5 text-left">
                      <button
                        type="button"
                        onClick={() => toggleSort("date")}
                        className="flex items-center gap-0.5 font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Date
                        {sortCol === "date" ? (
                          sortAsc ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTrades.map((t) => {
                    const profit = t.netProfit ?? t.grossProfit ?? 0;
                    const isSelected = t.id === selectedTradeId;
                    const lots = volumeToLots(t.volume ?? 0, t.symbol ?? "");
                    const dateVal = t.closeTime ?? t.openTime;
                    return (
                      <tr
                        key={t.id ?? t.ticketId ?? t.openTime?.toString()}
                        onClick={() => setSelectedTradeId(t.id ?? null)}
                        className={`cursor-pointer transition-colors ${
                          isSelected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/50"
                        }`}
                      >
                        <td className="px-2 py-1.5 font-medium truncate max-w-16">
                          {t.symbol}
                        </td>
                        <td
                          className={`px-2 py-1.5 ${
                            t.direction === "Buy"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-destructive"
                          }`}
                        >
                          {t.direction}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums">{lots.toFixed(2)}</td>
                        <td
                          className={`px-2 py-1.5 text-right tabular-nums ${
                            profit >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-destructive"
                          }`}
                        >
                          {formatProfit(profit)}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground tabular-nums">
                          {dateVal
                            ? format(new Date(dateVal), "MMM d HH:mm")
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Selected trade detail */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {selectedTradeId ? (
          <>
            {/* Quick nav */}
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
              <div className="flex gap-1">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded p-1.5 ${
                        activeTab === tab.id
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      title={tab.label}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={goPrev}
                  disabled={selectedIndex <= 0}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  aria-label="Previous trade"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs text-muted-foreground">
                  {selectedIndex + 1} / {trades.length}
                </span>
                <button
                  onClick={goNext}
                  disabled={selectedIndex >= trades.length - 1}
                  className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                  aria-label="Next trade"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div
              className={`flex-1 overflow-y-auto px-4 pb-4 ${
                activeTab === "chart" ? "pt-0" : "pt-4"
              }`}
            >
              <TradePanelDetailTabs
                tradeId={selectedTradeId}
                activeTab={activeTab}
              />
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a trade from the list above
          </div>
        )}
      </div>
    </div>
  );
}
