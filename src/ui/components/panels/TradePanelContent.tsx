"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
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
  Expand,
  Minimize2,
  Activity,
  X,
  RotateCcw,
} from "lucide-react";
import type { Trade } from "@domain/entities";
import { useTradePanel, type TradePanelSortState } from "@ui/providers";
import { TradePanelDetailTabs } from "./TradePanelDetailTabs";
import { TradePositionInput } from "@ui/components/common/TradePositionInput";
import { volumeToLots } from "@lib/pnl-estimate";

interface TradePanelContentProps {
  title: string;
  trades: Trade[];
  isLoading: boolean;
  initialSort?: TradePanelSortState | null;
  preserveInputOrder?: boolean;
  isExpanded: boolean;
  canResetToDefaultSize?: boolean;
  onToggleExpanded: () => void;
  onResetToDefaultSize?: () => void;
  onClosePanel: () => void;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

export function TradePanelContent({
  title,
  trades,
  isLoading,
  initialSort,
  preserveInputOrder = false,
  isExpanded,
  canResetToDefaultSize = false,
  onToggleExpanded,
  onResetToDefaultSize,
  onClosePanel,
}: TradePanelContentProps) {
  const { selectedTradeId, setSelectedTradeId } = useTradePanel();
  const [activeTab, setActiveTab] = useState<"details" | "journal" | "tags" | "chart" | "pnl">("details");
  type SortCol = TradePanelSortState["key"];
  const [sortCol, setSortCol] = useState<SortCol>(() => initialSort?.key ?? "date");
  const [sortAsc, setSortAsc] = useState(() => (initialSort?.dir ?? "desc") === "asc");
  const [useInputOrder, setUseInputOrder] = useState(
    () => Boolean(preserveInputOrder && !initialSort)
  );
  const [listCollapsed, setListCollapsed] = useState(false);
  const [chartExpanded, setChartExpanded] = useState(false);

  const summary = useMemo(() => {
    const total = trades.length;
    const totalProfit = trades.reduce((s, t) => s + (t.netProfit ?? t.grossProfit ?? 0), 0);
    const wins = trades.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) >= 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    return { total, totalProfit, wins, winRate };
  }, [trades]);

  const sortedTrades = useMemo(() => {
    if (useInputOrder) return trades;

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
          const lotsA =
            (a.lots != null && Number.isFinite(a.lots))
              ? a.lots
              : volumeToLots(a.volume ?? 0, a.symbol ?? "");
          const lotsB =
            (b.lots != null && Number.isFinite(b.lots))
              ? b.lots
              : volumeToLots(b.volume ?? 0, b.symbol ?? "");
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
          const tA = new Date(a.openTime ?? a.closeTime ?? 0).getTime();
          const tB = new Date(b.openTime ?? b.closeTime ?? 0).getTime();
          cmp = tA - tB;
          break;
        }
      }
      return mult * cmp;
    });
    return arr;
  }, [trades, sortCol, sortAsc, useInputOrder]);

  const toggleSort = (col: SortCol) => {
    setUseInputOrder(false);
    if (sortCol === col) {
      setSortAsc((a) => !a);
    } else {
      setSortCol(col);
      setSortAsc(col === "date" || col === "pnl" ? false : true);
    }
  };

  const selectedIndex = useMemo(
    () => sortedTrades.findIndex((t) => t.id === selectedTradeId),
    [sortedTrades, selectedTradeId]
  );
  const selectedTrade = selectedIndex >= 0 ? sortedTrades[selectedIndex] : null;

  useEffect(() => {
    if (sortedTrades.length === 0) return;
    const hasValidSelection =
      selectedTradeId != null && sortedTrades.some((t) => t.id === selectedTradeId);
    if (!hasValidSelection) {
      setSelectedTradeId(sortedTrades[0].id ?? null);
    }
  }, [sortedTrades, selectedTradeId, setSelectedTradeId]);

  useEffect(() => {
    const fireResize = () => window.dispatchEvent(new Event("resize"));
    const rafId = requestAnimationFrame(fireResize);
    const timeoutId = window.setTimeout(fireResize, 120);
    return () => {
      cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };
  }, [isExpanded, activeTab]);

  const goPrev = useCallback(() => {
    if (selectedIndex > 0) setSelectedTradeId(sortedTrades[selectedIndex - 1].id ?? null);
  }, [selectedIndex, setSelectedTradeId, sortedTrades]);

  const goNext = useCallback(() => {
    if (selectedIndex >= 0 && selectedIndex < sortedTrades.length - 1) {
      setSelectedTradeId(sortedTrades[selectedIndex + 1].id ?? null);
    }
  }, [selectedIndex, setSelectedTradeId, sortedTrades]);

  const goToTradePosition = useCallback((position: number) => {
    if (sortedTrades.length === 0) return;
    const nextIndex = Math.min(sortedTrades.length - 1, Math.max(0, position - 1));
    setSelectedTradeId(sortedTrades[nextIndex].id ?? null);
  }, [setSelectedTradeId, sortedTrades]);

  useEffect(() => {
    const isEditableTarget = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      return Boolean(
        el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable ||
            el.closest("[contenteditable='true']"))
      );
    };

    const handleShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === "PageDown" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        goNext();
        return;
      }

      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        goPrev();
      }
    };

    window.addEventListener("keydown", handleShortcut, true);
    return () => window.removeEventListener("keydown", handleShortcut, true);
  }, [goNext, goPrev]);

  const tabs = [
    { id: "details" as const, label: "Details", icon: BarChart3 },
    { id: "journal" as const, label: "Journal", icon: FileText },
    { id: "tags" as const, label: "Tags", icon: Tag },
    { id: "chart" as const, label: "Chart", icon: TrendingUp },
    { id: "pnl" as const, label: "P/L", icon: Activity },
  ];
  const isChartFocused = activeTab === "chart" || activeTab === "pnl";

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div
      className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
        isExpanded ? "gap-3 bg-muted/20 p-3 md:p-4" : ""
      }`}
    >
      {/* Summary */}
      <div
        className={`shrink-0 ${
          isExpanded
            ? "rounded-xl border border-border/70 bg-card/90 px-4 py-3 shadow-sm"
            : `border-b border-border ${isChartFocused ? "px-3 py-2" : "px-4 py-3"}`
        }`}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h2
              id="trade-panel-title"
              className={`truncate font-semibold text-foreground ${
                isExpanded ? "text-base" : isChartFocused ? "text-sm" : "text-sm"
              }`}
            >
              {title}
            </h2>
            <div className={`mt-1 flex flex-wrap ${isChartFocused ? "gap-3 text-xs" : "gap-4 text-sm"}`}>
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
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {canResetToDefaultSize && onResetToDefaultSize ? (
              <button
                type="button"
                onClick={onResetToDefaultSize}
                className={`hidden rounded text-muted-foreground hover:bg-accent hover:text-foreground md:inline-flex ${
                  isChartFocused ? "p-1" : "p-1.5"
                }`}
                aria-label="Reset panel to default width"
                title="Reset to default width"
              >
                <RotateCcw className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onToggleExpanded}
              className={`rounded text-muted-foreground hover:bg-accent hover:text-foreground ${
                isChartFocused ? "p-1" : "p-1.5"
              }`}
              aria-label={isExpanded ? "Exit full page" : "Expand to full page"}
            >
              {isExpanded ? (
                <Minimize2 className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
              ) : (
                <Expand className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={onClosePanel}
              className={`rounded text-muted-foreground hover:bg-accent hover:text-foreground ${
                isChartFocused ? "p-1" : "p-1.5"
              }`}
              aria-label="Close panel"
            >
              <X className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Trade list - sortable table (collapsible) */}
      <div
        className={`shrink-0 overflow-hidden ${
          isExpanded
            ? "rounded-xl border border-border/70 bg-card/90 shadow-sm"
            : "border-b border-border"
        }`}
      >
        <div
          className={`flex items-center justify-between ${
            isExpanded ? "px-3 py-2" : isChartFocused ? "px-3 py-1.5" : "px-4 py-2"
          }`}
        >
          <span
            className={`font-medium text-muted-foreground ${
              isExpanded ? "text-xs" : isChartFocused ? "text-[11px]" : "text-xs"
            }`}
          >
            Trades
          </span>
          <button
            type="button"
            onClick={() => setListCollapsed((v) => !v)}
            className={`rounded text-muted-foreground hover:bg-accent hover:text-foreground ${
              isChartFocused ? "p-0.5" : "p-1"
            }`}
          >
            {listCollapsed ? (
              <ChevronDown className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            ) : (
              <ChevronUp className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
            )}
            <span className="sr-only">
              {listCollapsed ? "Show trade list" : "Hide trade list"}
            </span>
          </button>
        </div>
        {listCollapsed ? (
          <div
            className={
              isExpanded
                ? "px-3 pb-2"
                : isChartFocused
                  ? "px-3 pb-1.5"
                  : "px-4 pb-2"
            }
          >
            {selectedTrade ? (
              <div
                className={`flex items-center justify-between ${
                  isExpanded ? "text-xs" : isChartFocused ? "text-[11px]" : "text-xs"
                }`}
              >
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium text-foreground">
                    {selectedTrade.symbol}
                  </span>
                  <span className="text-muted-foreground">
                    {selectedTrade.direction} ·{" "}
                    {(
                      selectedTrade.lots ??
                      volumeToLots(selectedTrade.volume ?? 0, selectedTrade.symbol ?? "")
                    ).toFixed(2)}{" "}
                    lots
                  </span>
                </div>
                <div className="text-right">
                  <span
                    className={`block tabular-nums ${
                      (selectedTrade.netProfit ?? selectedTrade.grossProfit ?? 0) >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-destructive"
                    }`}
                  >
                    {formatProfit(
                      selectedTrade.netProfit ?? selectedTrade.grossProfit ?? 0
                    )}
                  </span>
                  <span className="block text-[11px] text-muted-foreground">
                    {format(
                      new Date(selectedTrade.closeTime ?? selectedTrade.openTime ?? 0),
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
          <div
            className={
              isExpanded
                ? "max-h-36 overflow-y-auto"
                : isChartFocused
                  ? "max-h-28 overflow-y-auto"
                  : "max-h-40 overflow-y-auto"
            }
          >
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
                    const lots =
                      (t.lots != null && Number.isFinite(t.lots))
                        ? t.lots
                        : volumeToLots(t.volume ?? 0, t.symbol ?? "");
                    const dateVal = t.openTime ?? t.closeTime;
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
      <div
        className={`flex min-h-0 flex-1 flex-col overflow-hidden ${
          isExpanded ? "rounded-xl border border-border/70 bg-card/90 shadow-sm" : ""
        }`}
      >
        {selectedTradeId ? (
          <>
            {/* Quick nav */}
            <div
              className={`flex shrink-0 items-center justify-between border-b border-border ${
                isExpanded ? "px-3 py-2" : isChartFocused ? "px-3 py-1.5" : "px-4 py-2"
              }`}
            >
              <div className={isChartFocused ? "flex gap-0.5" : "flex gap-1"}>
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        setActiveTab(tab.id);
                        if (tab.id === "chart" || tab.id === "pnl") {
                          setListCollapsed(true);
                        } else {
                          setChartExpanded(false);
                        }
                      }}
                      className={`rounded ${isChartFocused ? "p-1" : "p-1.5"} ${
                        activeTab === tab.id
                          ? "bg-accent text-accent-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground"
                      }`}
                      title={tab.label}
                    >
                      <Icon className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} />
                    </button>
                  );
                })}
              </div>
              <div className={isChartFocused ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
                <button
                  onClick={goPrev}
                  disabled={selectedIndex <= 0}
                  className={`rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 ${
                    isChartFocused ? "p-1" : "p-1.5"
                  }`}
                  aria-label="Previous trade (PageUp or ArrowLeft)"
                  title="Previous trade (PageUp or ArrowLeft)"
                >
                  <ChevronLeft className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </button>
                {sortedTrades.length > 0 && selectedIndex >= 0 && (
                  <TradePositionInput
                    current={selectedIndex + 1}
                    total={sortedTrades.length}
                    onChangePosition={goToTradePosition}
                    separator="/"
                    wrapperClassName={isChartFocused ? "text-[11px]" : "text-xs"}
                    inputClassName={isChartFocused ? "h-5 text-[11px]" : "h-6 text-xs"}
                    textClassName="text-muted-foreground"
                    ariaLabel="Go to trade position"
                  />
                )}
                <button
                  onClick={goNext}
                  disabled={selectedIndex >= sortedTrades.length - 1}
                  className={`rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 ${
                    isChartFocused ? "p-1" : "p-1.5"
                  }`}
                  aria-label="Next trade (PageDown or ArrowRight)"
                  title="Next trade (PageDown or ArrowRight)"
                >
                  <ChevronRight className={isChartFocused ? "h-3.5 w-3.5" : "h-4 w-4"} />
                </button>
              </div>
            </div>

            {/* Tab content */}
            <div
              className={`flex-1 ${
                isExpanded && isChartFocused ? "overflow-hidden" : "overflow-y-auto"
              } ${
                isExpanded
                  ? isChartFocused
                    ? "px-3 pb-2 pt-1"
                    : "px-4 pb-4 pt-3"
                  : isChartFocused
                    ? "px-2 pb-2 pt-0"
                    : "px-4 pb-4 pt-4"
              }`}
            >
              <TradePanelDetailTabs
                tradeId={selectedTradeId}
                activeTab={activeTab}
                isPanelExpanded={isExpanded}
                onPrevTrade={goPrev}
                onNextTrade={goNext}
                canPrevTrade={selectedIndex > 0}
                canNextTrade={selectedIndex >= 0 && selectedIndex < sortedTrades.length - 1}
                onGoToTradePosition={goToTradePosition}
                isChartExpanded={chartExpanded}
                onChartExpandedChange={setChartExpanded}
                fallbackTrade={selectedTrade ?? undefined}
                currentTradePosition={selectedIndex >= 0 ? selectedIndex + 1 : 0}
                totalTrades={sortedTrades.length}
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
