"use client";

import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { endOfDay, endOfMonth, format, startOfDay, startOfMonth, subDays } from "date-fns";
import { Calendar, ChevronDown, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { volumeToLots } from "@lib/pnl-estimate";

type DirectionFilter = Direction | "Both";
type TradeSortKey = "direction" | "date" | "lots" | "pnl";
type TradeSortDirection = "asc" | "desc";
const DESKTOP_BREAKPOINT_PX = 768;
const DEFAULT_DESKTOP_PANEL_WIDTH_PX = 28 * 16;
const MAX_DESKTOP_PANEL_WIDTH_RATIO = 0.7;
const PANEL_WIDTH_STORAGE_KEY = "chart-trade-history-panel-desktop-width-v4";
const PANEL_WIDTH_CSS_VAR = "--chart-trade-history-panel-desktop-width";

export interface ChartTradeHistoryPanelData {
  symbol: string | null;
  broker: string | null;
  trades: Trade[];
  selectedTradeId: number | null;
  onSelectTrade: (trade: Trade) => void;
  onClose: () => void;
}

function getTradeTimestamp(trade: Trade): number {
  return new Date(trade.openTime).getTime();
}

function getTradeProfit(trade: Trade): number {
  return trade.netProfit ?? trade.grossProfit ?? 0;
}

function formatProfit(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}$${value.toFixed(2)}`;
}

function formatLots(trade: Trade): string {
  const lots =
    trade.lots != null && Number.isFinite(trade.lots)
      ? trade.lots
      : volumeToLots(trade.volume ?? 0, trade.symbol ?? "");
  return `${lots.toFixed(2)} lot${lots === 1 ? "" : "s"}`;
}

function getTradeKey(trade: Trade): string {
  if (trade.id != null) return String(trade.id);
  return `${trade.accountId}-${trade.symbol}-${new Date(trade.openTime).getTime()}`;
}

function formatDateInputValue(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

function parseDateInputValue(value: string, fallback: Date, endOfSelectedDay = false): Date {
  if (!value) return fallback;
  const nextDate = new Date(`${value}T00:00:00`);
  if (Number.isNaN(nextDate.getTime())) return fallback;
  return endOfSelectedDay ? endOfDay(nextDate) : startOfDay(nextDate);
}

export function ChartTradeHistoryPanel({
  symbol,
  broker,
  trades,
  selectedTradeId,
  onSelectTrade,
  onClose,
}: ChartTradeHistoryPanelData) {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= DESKTOP_BREAKPOINT_PX;
  });
  const [desktopPanelWidth, setDesktopPanelWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const minPanelWidth = DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const maxPanelWidth = Math.max(
      minPanelWidth,
      Math.floor(window.innerWidth * MAX_DESKTOP_PANEL_WIDTH_RATIO)
    );
    const rawStoredWidth = window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY);
    const storedWidth = rawStoredWidth ? Number(rawStoredWidth) : DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const nextWidth = Number.isFinite(storedWidth) ? storedWidth : DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    return Math.min(Math.max(nextWidth, minPanelWidth), maxPanelWidth);
  });
  const [isResizing, setIsResizing] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [sortKey, setSortKey] = useState<TradeSortKey>("date");
  const [sortDirection, setSortDirection] = useState<TradeSortDirection>("desc");
  const [dateDraftFrom, setDateDraftFrom] = useState("");
  const [dateDraftTo, setDateDraftTo] = useState("");
  const dateRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<HTMLDivElement>(null);
  const desktopPanelWidthRef = useRef(desktopPanelWidth);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    desktopPanelWidthRef.current = desktopPanelWidth;
  }, [desktopPanelWidth]);

  const clampDesktopWidth = (width: number) => {
    if (typeof window === "undefined") return width;
    const minPanelWidth = DEFAULT_DESKTOP_PANEL_WIDTH_PX;
    const maxPanelWidth = Math.max(
      minPanelWidth,
      Math.floor(window.innerWidth * MAX_DESKTOP_PANEL_WIDTH_RATIO)
    );
    return Math.min(Math.max(width, minPanelWidth), maxPanelWidth);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT_PX);
      setDesktopPanelWidth((current) => clampDesktopWidth(current));
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      PANEL_WIDTH_CSS_VAR,
      `${desktopPanelWidth}px`
    );
  }, [desktopPanelWidth]);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      if (typeof document === "undefined") return;
      document.documentElement.style.removeProperty(PANEL_WIDTH_CSS_VAR);
    };
  }, []);

  useEffect(() => {
    if (!isResizing || typeof document === "undefined") return;
    const bodyStyle = document.body.style;
    const previousCursor = bodyStyle.cursor;
    const previousUserSelect = bodyStyle.userSelect;
    bodyStyle.cursor = "col-resize";
    bodyStyle.userSelect = "none";
    return () => {
      bodyStyle.cursor = previousCursor;
      bodyStyle.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  const handleResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (typeof window === "undefined" || window.innerWidth < DESKTOP_BREAKPOINT_PX) {
      return;
    }
    event.preventDefault();
    resizeCleanupRef.current?.();
    const startX = event.clientX;
    const startWidth = desktopPanelWidthRef.current;
    setIsResizing(true);

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      setDesktopPanelWidth(clampDesktopWidth(startWidth + delta));
    };

    const finishResize = () => {
      setIsResizing(false);
      window.localStorage.setItem(
        PANEL_WIDTH_STORAGE_KEY,
        String(desktopPanelWidthRef.current)
      );
      removeResizeListeners();
    };

    const removeResizeListeners = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      resizeCleanupRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    resizeCleanupRef.current = removeResizeListeners;
  };

  const handleResetPanelWidth = () => {
    const defaultWidth = clampDesktopWidth(DEFAULT_DESKTOP_PANEL_WIDTH_PX);
    setDesktopPanelWidth(defaultWidth);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(defaultWidth));
    }
  };

  const tradeBounds = useMemo(() => {
    if (trades.length === 0) {
      const today = new Date();
      return {
        from: startOfDay(today),
        to: endOfDay(today),
      };
    }

    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;
    for (const trade of trades) {
      const timestamp = getTradeTimestamp(trade);
      minTime = Math.min(minTime, timestamp);
      maxTime = Math.max(maxTime, timestamp);
    }

    return {
      from: startOfDay(new Date(minTime)),
      to: endOfDay(new Date(maxTime)),
    };
  }, [trades]);

  const filterKey = `${broker ?? "no-broker"}|${symbol ?? "no-symbol"}|${tradeBounds.from.getTime()}|${tradeBounds.to.getTime()}`;
  const [filterState, setFilterState] = useState<{
    key: string;
    from: Date;
    to: Date;
    direction: DirectionFilter;
  }>(() => ({
    key: filterKey,
    from: tradeBounds.from,
    to: tradeBounds.to,
    direction: "Both",
  }));

  const activeFilters =
    filterState.key === filterKey
      ? filterState
      : {
          key: filterKey,
          from: tradeBounds.from,
          to: tradeBounds.to,
          direction: "Both" as DirectionFilter,
        };
  const { from, to, direction } = activeFilters;

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!dateRef.current?.contains(target)) {
        setDateOpen(false);
      }
      if (!directionRef.current?.contains(target)) {
        setDirectionOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const filteredTrades = useMemo(() => {
    const fromTime = startOfDay(from).getTime();
    const toTime = endOfDay(to).getTime();

    return trades
      .filter((trade) => direction === "Both" || trade.direction === direction)
      .filter((trade) => {
        const tradeTime = getTradeTimestamp(trade);
        return tradeTime >= fromTime && tradeTime <= toTime;
      });
  }, [direction, from, to, trades]);

  const sortedTrades = useMemo(() => {
    const multiplier = sortDirection === "asc" ? 1 : -1;
    return [...filteredTrades].sort((left, right) => {
      switch (sortKey) {
        case "direction":
          return multiplier * (left.direction ?? "").localeCompare(right.direction ?? "");
        case "lots": {
          const leftLots =
            left.lots != null && Number.isFinite(left.lots)
              ? left.lots
              : volumeToLots(left.volume ?? 0, left.symbol ?? "");
          const rightLots =
            right.lots != null && Number.isFinite(right.lots)
              ? right.lots
              : volumeToLots(right.volume ?? 0, right.symbol ?? "");
          return multiplier * (leftLots - rightLots);
        }
        case "pnl":
          return multiplier * (getTradeProfit(left) - getTradeProfit(right));
        case "date":
        default:
          return multiplier * (getTradeTimestamp(left) - getTradeTimestamp(right));
      }
    });
  }, [filteredTrades, sortDirection, sortKey]);

  const summary = useMemo(() => {
    const total = filteredTrades.length;
    const totalProfit = filteredTrades.reduce((sum, trade) => sum + getTradeProfit(trade), 0);
    const wins = filteredTrades.filter((trade) => getTradeProfit(trade) >= 0).length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    return { total, totalProfit, winRate };
  }, [filteredTrades]);

  const subtitle = broker && symbol ? `${broker} - ${symbol}` : symbol ?? "Trade history";
  const rangeLabel = `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;

  const openDatePicker = () => {
    setDateDraftFrom(formatDateInputValue(from));
    setDateDraftTo(formatDateInputValue(to));
    setDateOpen((open) => !open);
    setDirectionOpen(false);
  };

  const applyDateDraft = () => {
    const nextFrom = parseDateInputValue(dateDraftFrom, from, false);
    const nextToRaw = parseDateInputValue(dateDraftTo, to, true);
    const nextTo = nextToRaw.getTime() < nextFrom.getTime() ? endOfDay(nextFrom) : nextToRaw;

    setFilterState((current) => ({
      ...current,
      key: filterKey,
      from: nextFrom,
      to: nextTo,
    }));
    setDateOpen(false);
  };

  const panelBody = (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-visible"
    >
      <div
        className="shrink-0 border-b border-border px-4 py-3"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0">
            <h2 id="chart-trade-history-title" className="truncate text-sm font-semibold text-foreground">
              Trade history
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {desktopPanelWidth > DEFAULT_DESKTOP_PANEL_WIDTH_PX ? (
              <button
                type="button"
                onClick={handleResetPanelWidth}
                className="hidden rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground md:inline-flex"
                aria-label="Reset panel to default width"
                title="Reset to default width"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Close panel"
              title="Close panel"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 py-2 md:px-3 md:py-2">
        <div className="relative z-20 grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="relative" ref={dateRef}>
            <button
              type="button"
              onClick={openDatePicker}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs text-foreground transition-colors hover:bg-accent"
            >
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{rangeLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {dateOpen ? (
              <div className="absolute left-0 top-full z-[80] mt-2 w-[320px] rounded-xl border border-border bg-popover p-3 shadow-2xl">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">Date range</span>
                  <button
                    type="button"
                    onClick={() => setDateOpen(false)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    aria-label="Close date picker"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextFrom = startOfDay(subDays(new Date(), 6));
                      const nextTo = endOfDay(new Date());
                      setDateDraftFrom(formatDateInputValue(nextFrom));
                      setDateDraftTo(formatDateInputValue(nextTo));
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                  >
                    7D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextFrom = startOfDay(subDays(new Date(), 29));
                      const nextTo = endOfDay(new Date());
                      setDateDraftFrom(formatDateInputValue(nextFrom));
                      setDateDraftTo(formatDateInputValue(nextTo));
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                  >
                    30D
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const now = new Date();
                      setDateDraftFrom(formatDateInputValue(startOfMonth(now)));
                      setDateDraftTo(formatDateInputValue(endOfMonth(now)));
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                  >
                    Month
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDateDraftFrom(formatDateInputValue(tradeBounds.from));
                      setDateDraftTo(formatDateInputValue(tradeBounds.to));
                    }}
                    className="rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
                  >
                    All
                  </button>
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      From
                    </span>
                    <input
                      type="date"
                      value={dateDraftFrom}
                      onChange={(event) => setDateDraftFrom(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      To
                    </span>
                    <input
                      type="date"
                      value={dateDraftTo}
                      onChange={(event) => setDateDraftTo(event.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground"
                    />
                  </label>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setDateOpen(false)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyDateDraft}
                    className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    Apply
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative" ref={directionRef}>
            <button
              type="button"
              onClick={() => {
                setDirectionOpen((open) => !open);
                setDateOpen(false);
              }}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-xs text-foreground transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate">{direction}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            {directionOpen ? (
              <div className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-border bg-popover p-1 shadow-lg">
                {(["Both", Direction.Buy, Direction.Sell] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setFilterState((current) => ({
                        ...current,
                        key: filterKey,
                        direction: option,
                      }));
                      setDirectionOpen(false);
                    }}
                    className={`flex w-full items-center rounded-md px-3 py-2 text-left text-xs transition-colors ${
                      option === direction
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Trades
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">{summary.total}</div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              P/L
            </div>
            <div
              className={`mt-1 text-sm font-semibold ${
                summary.totalProfit >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {formatProfit(summary.totalProfit)}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background px-3 py-2">
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Win rate
            </div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {summary.winRate.toFixed(0)}%
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-background">
          <div className="border-b border-border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">Trades</span>
              <div className="flex items-center gap-2">
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as TradeSortKey)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none"
                  aria-label="Sort trades by"
                >
                  <option value="direction">Direction</option>
                  <option value="date">Date</option>
                  <option value="lots">Lots</option>
                  <option value="pnl">P/L</option>
                </select>
                <select
                  value={sortDirection}
                  onChange={(event) => setSortDirection(event.target.value as TradeSortDirection)}
                  className="h-7 rounded-md border border-border bg-background px-2 text-[11px] text-foreground outline-none"
                  aria-label="Sort direction"
                >
                  <option value="desc">Desc</option>
                  <option value="asc">Asc</option>
                </select>
              </div>
            </div>
          </div>
          <div className="h-full overflow-y-auto">
            {sortedTrades.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No trades match the current filters.
              </div>
            ) : (
              sortedTrades.map((trade) => {
                const tradeProfit = getTradeProfit(trade);
                const isSelected = trade.id != null && trade.id === selectedTradeId;

                return (
                  <button
                    key={getTradeKey(trade)}
                    type="button"
                    onClick={() => onSelectTrade(trade)}
                    className={`flex w-full items-start justify-between gap-3 border-b border-border/70 px-3 py-3 text-left transition-colors last:border-b-0 ${
                      isSelected
                        ? "bg-primary/10"
                        : "hover:bg-muted/60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {trade.symbol}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            trade.direction === Direction.Buy
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {trade.direction}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {format(new Date(trade.openTime), "MMM d, yyyy · HH:mm")}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatLots(trade)}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div
                        className={`text-sm font-semibold ${
                          tradeProfit >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                        }`}
                      >
                        {formatProfit(tradeProfit)}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <aside
      className="relative flex h-screen w-full shrink-0 flex-col overflow-visible border-l border-border bg-background md:w-[var(--chart-trade-history-panel-desktop-width)] md:min-w-[28rem] md:max-w-[70vw]"
      style={
        ({
          ...(isDesktop ? { width: desktopPanelWidth } : undefined),
          [PANEL_WIDTH_CSS_VAR]: `${desktopPanelWidth}px`,
        }) as CSSProperties
      }
      role="complementary"
      aria-labelledby="chart-trade-history-title"
    >
      <div
        className="absolute inset-y-0 left-0 z-10 hidden w-4 cursor-col-resize touch-none items-center justify-center md:flex"
        role="separator"
        aria-label="Resize chart trade history panel"
        aria-orientation="vertical"
        onPointerDown={handleResizeStart}
      >
        <span
          className={`h-full w-px transition-colors ${
            isResizing ? "bg-primary/70" : "bg-border/70 hover:bg-primary/50"
          }`}
        />
      </div>
      {panelBody}
    </aside>
  );
}
