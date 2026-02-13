"use client";

import { useState, useMemo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  addDays,
  addMonths,
  isSameMonth,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarMonthReturns } from "@ui/hooks";
import type { Direction } from "@domain/enums";

interface DayReturn {
  period: string;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
  winningTrades?: number;
  losingTrades?: number;
}

interface PerformanceCalendarProps {
  accountId: string;
  symbols: string[];
  direction: Direction | "Both";
  /** Initial month to show (e.g. from dashboard filter) */
  initialMonth?: Date;
  /** When a day with trades is clicked, open panel with that day's trades */
  onDayClick?: (date: Date) => void;
  /** When a week total with trades is clicked, open panel with that week's trades */
  onWeekClick?: (weekStart: Date, weekEnd: Date) => void;
  /** When the month total (e.g. "75 trades") is clicked, open panel with that month's trades */
  onMonthClick?: (monthStart: Date, monthEnd: Date) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatProfit(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function formatProfitCompact(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const abs = Math.abs(n);

  if (abs >= 1000) {
    const val = abs >= 10000 ? abs / 1000 : Number((abs / 1000).toFixed(1));
    return `${sign}$${val}k`;
  }

  if (abs >= 100) {
    return `${sign}$${abs.toFixed(0)}`;
  }

  return `${sign}$${abs.toFixed(1)}`;
}

export function PerformanceCalendar({
  accountId,
  symbols,
  direction,
  initialMonth,
  onDayClick,
  onWeekClick,
  onMonthClick,
}: PerformanceCalendarProps) {
  const baseMonth = useMemo(() => startOfMonth(initialMonth ?? new Date()), [initialMonth]);
  const [monthOffset, setMonthOffset] = useState(0);
  const viewMonth = useMemo(() => addMonths(baseMonth, monthOffset), [baseMonth, monthOffset]);
  const { daily, loading: calendarLoading } = useCalendarMonthReturns(
    accountId,
    viewMonth,
    symbols,
    direction
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DayReturn>();
    for (const d of daily) {
      map.set(d.period, d);
    }
    return map;
  }, [daily]);

  const monthKey = format(viewMonth, "yyyy-MM");
  const monthData = useMemo(() => {
    return daily.filter((d) => d.period.startsWith(monthKey));
  }, [daily, monthKey]);

  const monthSummary = useMemo(() => {
    const trades = monthData.reduce((a, d) => a + d.tradeCount, 0);
    const profit = monthData.reduce((a, d) => a + d.profit, 0);
    const winningTrades = monthData.reduce((a, d) => a + (d.winningTrades ?? 0), 0);
    const losingTrades = monthData.reduce((a, d) => a + (d.losingTrades ?? 0), 0);
    const decidedTrades = winningTrades + losingTrades;
    const winRate = decidedTrades > 0 ? (winningTrades / decidedTrades) * 100 : 0;
    return { trades, profit, winRate };
  }, [monthData]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    const result: Date[][] = [];
    let weekStart = start;
    while (weekStart <= end) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(addDays(weekStart, i));
      }
      result.push(week);
      weekStart = addDays(weekStart, 7);
    }
    return result;
  }, [viewMonth]);

  const weekTotals = useMemo(() => {
    return weeks.map((weekDays) => {
      let profit = 0;
      let trades = 0;
      for (const d of weekDays) {
        const key = format(d, "yyyy-MM-dd");
        const row = byDate.get(key);
        if (row) {
          profit += row.profit;
          trades += row.tradeCount;
        }
      }
      return { profit, trades };
    });
  }, [weeks, byDate]);

  const goPrev = () => setMonthOffset((m) => m - 1);
  const goNext = () => setMonthOffset((m) => m + 1);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="p-3 pb-3 sm:p-5 sm:pb-4">
        <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <div className="flex items-center justify-between gap-1 sm:justify-start">
            <button
              type="button"
              onClick={goPrev}
              className="rounded-full p-2 text-muted-foreground transition-all duration-200 hover:scale-110 hover:bg-muted hover:text-foreground active:scale-95"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h3 className="min-w-[120px] text-center text-sm font-semibold tabular-nums text-foreground sm:min-w-[160px] sm:text-base">
              {format(viewMonth, "MMMM yyyy")}
            </h3>
            <button
              type="button"
              onClick={goNext}
              className="rounded-full p-2 text-muted-foreground transition-all duration-200 hover:scale-110 hover:bg-muted hover:text-foreground active:scale-95"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-end sm:gap-3">
            {calendarLoading ? (
              <span className="rounded-full bg-muted/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground sm:px-3 sm:py-1.5 sm:text-xs">
                Loading...
              </span>
            ) : monthSummary.trades === 0 ? (
              <span className="rounded-full bg-muted/80 px-2.5 py-1 text-[10px] font-medium text-muted-foreground sm:px-3 sm:py-1.5 sm:text-xs">
                No trades this month
              </span>
            ) : (
              <>
                {monthSummary.trades > 0 && onMonthClick ? (
                  <button
                    type="button"
                    onClick={() =>
                      onMonthClick(
                        startOfDay(startOfMonth(viewMonth)),
                        endOfDay(endOfMonth(viewMonth))
                      )
                    }
                    className="cursor-pointer rounded-full bg-muted/80 px-2.5 py-1 text-[10px] font-medium text-foreground transition-colors hover:bg-muted sm:px-3 sm:py-1.5 sm:text-xs"
                  >
                    {monthSummary.trades} trades
                  </button>
                ) : (
                  <span className="rounded-full bg-muted/80 px-2.5 py-1 text-[10px] font-medium text-foreground sm:px-3 sm:py-1.5 sm:text-xs">
                    {monthSummary.trades} trades
                  </span>
                )}

                <span className="rounded-full bg-muted/80 px-2.5 py-1 text-[10px] font-medium text-foreground sm:px-3 sm:py-1.5 sm:text-xs">
                  {monthSummary.winRate.toFixed(0)}% win rate
                </span>

                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold sm:px-3 sm:py-1.5 sm:text-xs ${
                    monthSummary.profit >= 0
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : "bg-red-500/15 text-red-600 dark:text-red-400"
                  }`}
                >
                  {formatProfit(monthSummary.profit)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="px-2 pb-3 sm:px-4 sm:pb-4">
        <div className="w-full">
          <div className="mb-1.5 grid grid-cols-7 gap-1 sm:mb-2 sm:grid-cols-8 sm:gap-2">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:py-2 sm:text-[11px]"
              >
                {label}
              </div>
            ))}
            <div className="hidden py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:block sm:py-2 sm:text-[11px]">
              Week
            </div>
          </div>

          {weeks.map((weekDays, wi) => {
            const weekTotal = weekTotals[wi];
            const weekIsProfit = weekTotal.profit >= 0;

            return (
              <div key={wi} className="mb-1.5 sm:mb-2">
                <div className="grid grid-cols-7 gap-1 sm:grid-cols-8 sm:gap-2">
                  {weekDays.map((day) => {
                    const key = format(day, "yyyy-MM-dd");
                    const data = byDate.get(key);
                    const isCurrentMonth = isSameMonth(day, viewMonth);
                    const hasData = Boolean(data && data.tradeCount > 0);
                    const isProfit = hasData && (data?.profit ?? 0) >= 0;

                    return (
                      <div
                        key={key}
                        role={hasData && onDayClick ? "button" : undefined}
                        onClick={hasData && onDayClick ? () => onDayClick(day) : undefined}
                        className={`relative flex min-h-[52px] flex-col rounded-lg p-1 transition-all duration-200 ease-out active:scale-[0.98] sm:min-h-[72px] sm:rounded-xl sm:p-2.5 ${
                          hasData && onDayClick ? "cursor-pointer" : "cursor-default"
                        } ${!isCurrentMonth ? "opacity-35" : ""} ${
                          hasData
                            ? isProfit
                              ? "bg-emerald-500/10 ring-1 ring-emerald-500/20 hover:scale-[1.03] hover:bg-emerald-500/15 hover:shadow-md hover:ring-2 hover:ring-emerald-500/40 hover:z-10 dark:bg-emerald-500/20 dark:hover:bg-emerald-500/25"
                              : "bg-red-500/10 ring-1 ring-red-500/20 hover:scale-[1.03] hover:bg-red-500/15 hover:shadow-md hover:ring-2 hover:ring-red-500/40 hover:z-10 dark:bg-red-500/20 dark:hover:bg-red-500/25"
                            : "bg-muted/30 hover:scale-[1.03] hover:bg-muted/50 hover:shadow-md hover:ring-1 hover:ring-border hover:z-10 dark:bg-muted/20 dark:hover:bg-muted/30"
                        }`}
                      >
                        <span
                          className={`text-[9px] font-medium leading-tight sm:text-[11px] ${
                            isCurrentMonth ? "text-foreground/80" : "text-muted-foreground"
                          }`}
                        >
                          {format(day, "d")}
                        </span>

                        {hasData ? (
                          <>
                            <span
                              className={`mt-0.5 text-[10px] font-semibold leading-tight tabular-nums sm:mt-1 sm:text-[13px] ${
                                isProfit
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : "text-red-600 dark:text-red-400"
                              }`}
                            >
                              <span className="sm:hidden">{formatProfitCompact(data!.profit)}</span>
                              <span className="hidden sm:inline">{formatProfit(data!.profit)}</span>
                            </span>
                            <span className="mt-0.5 text-[8px] leading-tight text-muted-foreground sm:text-[10px]">
                              {data!.tradeCount} trade{data!.tradeCount !== 1 ? "s" : ""}
                            </span>
                          </>
                        ) : (
                          <span className="mt-0.5 text-[10px] leading-tight text-muted-foreground/50 sm:mt-1 sm:text-[11px]">
                            --
                          </span>
                        )}
                      </div>
                    );
                  })}

                  {weekTotal.trades > 0 && onWeekClick ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onWeekClick(startOfDay(weekDays[0]), endOfDay(weekDays[6]));
                      }}
                      className={`hidden min-h-[52px] flex-col justify-center rounded-lg p-1 transition-all duration-200 sm:flex sm:min-h-[72px] sm:rounded-xl sm:p-2.5 ${
                        weekIsProfit
                          ? "bg-emerald-500/5 ring-1 ring-emerald-500/20 hover:scale-[1.03] hover:bg-emerald-500/10 hover:shadow-md hover:ring-2 hover:ring-emerald-500/40 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/20"
                          : "bg-red-500/5 ring-1 ring-red-500/20 hover:scale-[1.03] hover:bg-red-500/10 hover:shadow-md hover:ring-2 hover:ring-red-500/40 dark:bg-red-500/15 dark:hover:bg-red-500/20"
                      } cursor-pointer`}
                    >
                      <span
                        className={`text-[10px] font-semibold leading-tight tabular-nums sm:text-[13px] ${
                          weekIsProfit
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {formatProfit(weekTotal.profit)}
                      </span>
                      <span className="mt-0.5 text-[8px] leading-tight text-muted-foreground sm:text-[10px]">
                        {weekTotal.trades} trades
                      </span>
                    </button>
                  ) : (
                    <div className="hidden min-h-[52px] flex-col justify-center rounded-lg bg-muted/50 p-1 ring-1 ring-border/50 sm:flex sm:min-h-[72px] sm:rounded-xl sm:p-2.5 dark:bg-muted/30">
                      <span className="text-[10px] leading-tight text-muted-foreground/50 sm:text-[11px]">--</span>
                    </div>
                  )}
                </div>

                {weekTotal.trades > 0 && onWeekClick ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onWeekClick(startOfDay(weekDays[0]), endOfDay(weekDays[6]));
                    }}
                    className={`mt-1 flex min-h-[34px] w-full items-center justify-between rounded-lg px-2 py-1 text-[10px] sm:hidden ${
                      weekIsProfit
                        ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-emerald-500/25 dark:bg-emerald-500/20 dark:text-emerald-400"
                        : "bg-red-500/10 text-red-600 ring-1 ring-red-500/25 dark:bg-red-500/20 dark:text-red-400"
                    }`}
                  >
                    <span className="font-semibold uppercase tracking-wide">Week</span>
                    <span className="font-semibold tabular-nums">{formatProfitCompact(weekTotal.profit)}</span>
                    <span className="text-muted-foreground">{weekTotal.trades} trades</span>
                  </button>
                ) : (
                  <div className="mt-1 flex min-h-[34px] w-full items-center justify-center rounded-lg bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground/60 ring-1 ring-border/50 sm:hidden">
                    --
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
