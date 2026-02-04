"use client";

import { useState, useMemo, useEffect } from "react";
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
  subMonths,
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
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
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
  const [viewMonth, setViewMonth] = useState<Date>(() =>
    initialMonth ? startOfMonth(initialMonth) : startOfMonth(new Date())
  );
  // When top date range changes (initialMonth), sync calendar to that month
  useEffect(() => {
    if (initialMonth) {
      setViewMonth(startOfMonth(initialMonth));
    }
  }, [initialMonth?.getTime()]);
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

  const monthsWithData = useMemo(() => {
    const set = new Set(daily.map((d) => d.period.slice(0, 7)));
    return Array.from(set).sort();
  }, [daily]);

  const monthKey = format(viewMonth, "yyyy-MM");
  const monthData = useMemo(() => {
    return daily.filter((d) => d.period.startsWith(monthKey));
  }, [daily, monthKey]);

  const monthSummary = useMemo(() => {
    const trades = monthData.reduce((a, d) => a + d.tradeCount, 0);
    const profit = monthData.reduce((a, d) => a + d.profit, 0);
    const winning = monthData.reduce((a, d) => a + d.winning, 0);
    const losing = monthData.reduce((a, d) => a + Math.abs(d.losing), 0);
    const total = winning + losing;
    const winPct = total > 0 ? (winning / total) * 100 : 0;
    return { trades, profit, winPct };
  }, [monthData]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    const weeks: Date[][] = [];
    let weekStart = start;
    while (weekStart <= end) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(addDays(weekStart, i));
      }
      weeks.push(week);
      weekStart = addDays(weekStart, 7);
    }
    return weeks;
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

  const goPrev = () => setViewMonth((m) => subMonths(m, 1));
  const goNext = () => setViewMonth((m) => addMonths(m, 1));

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="p-3 sm:p-5 pb-3 sm:pb-4">
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center justify-between sm:justify-start gap-1">
            <button
              type="button"
              onClick={goPrev}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-110 active:scale-95 transition-all duration-200"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <h3 className="text-sm sm:text-base font-semibold text-foreground min-w-[120px] sm:min-w-[160px] text-center tabular-nums">
              {format(viewMonth, "MMMM yyyy")}
            </h3>
            <button
              type="button"
              onClick={goNext}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground hover:scale-110 active:scale-95 transition-all duration-200"
              aria-label="Next month"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 sm:gap-3">
            {calendarLoading ? (
              <span className="rounded-full bg-muted/80 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-muted-foreground">
                Loading…
              </span>
            ) : monthSummary.trades === 0 ? (
              <span className="rounded-full bg-muted/80 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-muted-foreground">
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
                    className="rounded-full bg-muted/80 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-foreground hover:bg-muted cursor-pointer transition-colors"
                  >
                    {monthSummary.trades} trades
                  </button>
                ) : (
                  <span className="rounded-full bg-muted/80 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-foreground">
                    {monthSummary.trades} trades
                  </span>
                )}
                <span className="rounded-full bg-muted/80 px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium text-foreground">
                  {monthSummary.winPct.toFixed(0)}% gain
                </span>
                <span
                  className={`rounded-full px-2.5 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-semibold ${
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

      <div className="px-2 sm:px-4 pb-3 sm:pb-4 overflow-x-auto -mx-px">
        <div className="min-w-[20rem] w-full">
          {/* Weekday headers */}
          <div className="grid grid-cols-8 gap-1.5 sm:gap-2 mb-1.5 sm:mb-2">
            {WEEKDAY_LABELS.map((label) => (
              <div
                key={label}
                className="py-1.5 sm:py-2 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {label}
              </div>
            ))}
            <div className="py-1.5 sm:py-2 text-center text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Week
            </div>
          </div>

          {/* Week rows */}
          {weeks.map((weekDays, wi) => (
            <div
              key={wi}
              className="grid grid-cols-8 gap-1.5 sm:gap-2 mb-1.5 sm:mb-2"
            >
              {weekDays.map((day) => {
                const key = format(day, "yyyy-MM-dd");
                const data = byDate.get(key);
                const isCurrentMonth = isSameMonth(day, viewMonth);
                const hasData = data && data.tradeCount > 0;
                const isProfit = hasData && data!.profit >= 0;
                return (
                  <div
                    key={key}
                    role={hasData && onDayClick ? "button" : undefined}
                    onClick={hasData && onDayClick ? () => onDayClick(day) : undefined}
                    className={`
                      relative rounded-lg sm:rounded-xl min-h-[56px] sm:min-h-[72px] flex flex-col p-1.5 sm:p-2.5
                      transition-all duration-200 ease-out
                      hover:scale-[1.03] hover:shadow-md hover:z-10
                      active:scale-[0.98]
                      ${hasData && onDayClick ? "cursor-pointer" : "cursor-default"}
                      ${!isCurrentMonth ? "opacity-35" : ""}
                      ${hasData ? (isProfit ? "bg-emerald-500/10 dark:bg-emerald-500/20 ring-1 ring-emerald-500/20 hover:ring-2 hover:ring-emerald-500/40 hover:bg-emerald-500/15 dark:hover:bg-emerald-500/25" : "bg-red-500/10 dark:bg-red-500/20 ring-1 ring-red-500/20 hover:ring-2 hover:ring-red-500/40 hover:bg-red-500/15 dark:hover:bg-red-500/25") : "bg-muted/30 dark:bg-muted/20 hover:bg-muted/50 dark:hover:bg-muted/30 hover:ring-1 hover:ring-border"}
                    `}
                  >
                    <span
                      className={`text-[10px] sm:text-[11px] font-medium ${
                        isCurrentMonth ? "text-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      {format(day, "d")}
                    </span>
                    {data && data.tradeCount > 0 ? (
                      <>
                        <span
                          className={`mt-0.5 sm:mt-1 font-semibold text-[11px] sm:text-[13px] tabular-nums ${
                            isProfit
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {formatProfit(data.profit)}
                        </span>
                        <span className="mt-0.5 text-[9px] sm:text-[10px] text-muted-foreground">
                          {data.tradeCount} trade{data.tradeCount !== 1 ? "s" : ""}
                        </span>
                      </>
                    ) : (
                      <span className="mt-0.5 sm:mt-1 text-muted-foreground/50 text-[10px] sm:text-[11px]">—</span>
                    )}
                  </div>
                );
              })}
              {weekTotals[wi].trades > 0 && onWeekClick ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onWeekClick(startOfDay(weekDays[0]), endOfDay(weekDays[6]));
                  }}
                  className={
                    weekTotals[wi].profit >= 0
                      ? "rounded-lg sm:rounded-xl min-h-[56px] sm:min-h-[72px] flex flex-col justify-center p-1.5 sm:p-2.5 bg-emerald-500/5 dark:bg-emerald-500/15 ring-1 ring-emerald-500/20 transition-all duration-200 hover:scale-[1.03] hover:shadow-md hover:ring-2 hover:ring-emerald-500/40 hover:bg-emerald-500/10 dark:hover:bg-emerald-500/20 cursor-pointer"
                      : "rounded-lg sm:rounded-xl min-h-[56px] sm:min-h-[72px] flex flex-col justify-center p-1.5 sm:p-2.5 bg-red-500/5 dark:bg-red-500/15 ring-1 ring-red-500/20 transition-all duration-200 hover:scale-[1.03] hover:shadow-md hover:ring-2 hover:ring-red-500/40 hover:bg-red-500/10 dark:hover:bg-red-500/20 cursor-pointer"
                  }
                >
                  <span
                    className={`font-semibold text-[11px] sm:text-[13px] tabular-nums ${
                      weekTotals[wi].profit >= 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatProfit(weekTotals[wi].profit)}
                  </span>
                  <span className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5">
                    {weekTotals[wi].trades} trades
                  </span>
                </button>
              ) : (
                <div
                  className={
                    "rounded-lg sm:rounded-xl min-h-[56px] sm:min-h-[72px] flex flex-col justify-center p-1.5 sm:p-2.5 bg-muted/50 dark:bg-muted/30 ring-1 ring-border/50 transition-all duration-200 cursor-default"
                  }
                >
                  <span className="text-muted-foreground/50 text-[10px] sm:text-[11px]">—</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
