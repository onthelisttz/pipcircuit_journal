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
  isToday,
  isWeekend,
} from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarMonthReturns } from "@ui/hooks";
import type { Direction } from "@domain/enums";
import type { TradeQuery } from "@application/ports/repositories";

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
  advancedQuery?: Pick<TradeQuery, "ratingValues" | "mindsets" | "tagIds">;
  initialMonth?: Date;
  onDayClick?: (date: Date) => void;
  onWeekClick?: (weekStart: Date, weekEnd: Date) => void;
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
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(1)}`;
}

function intensityClass(profit: number, maxAbs: number, isProfit: boolean): string {
  if (maxAbs === 0) return "";
  const ratio = Math.abs(profit) / maxAbs;
  // 4 tiers of intensity
  const tier = ratio > 0.66 ? 3 : ratio > 0.33 ? 2 : ratio > 0.12 ? 1 : 0;
  if (isProfit) {
    return [
      "bg-emerald-500/[0.07] ring-emerald-500/20 dark:bg-emerald-500/[0.14]",
      "bg-emerald-500/[0.12] ring-emerald-500/25 dark:bg-emerald-500/[0.20]",
      "bg-emerald-500/[0.18] ring-emerald-500/30 dark:bg-emerald-500/[0.28]",
      "bg-emerald-500/[0.26] ring-emerald-500/35 dark:bg-emerald-500/[0.36]",
    ][tier];
  }
  return [
    "bg-red-500/[0.07] ring-red-500/20 dark:bg-red-500/[0.14]",
    "bg-red-500/[0.12] ring-red-500/25 dark:bg-red-500/[0.20]",
    "bg-red-500/[0.18] ring-red-500/30 dark:bg-red-500/[0.26]",
    "bg-red-500/[0.26] ring-red-500/35 dark:bg-red-500/[0.34]",
  ][tier];
}

export function PerformanceCalendar({
  accountId,
  symbols,
  direction,
  advancedQuery,
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
    direction,
    advancedQuery
  );

  const byDate = useMemo(() => {
    const map = new Map<string, DayReturn>();
    for (const d of daily) map.set(d.period, d);
    return map;
  }, [daily]);

  const monthKey = format(viewMonth, "yyyy-MM");
  const monthData = useMemo(() => daily.filter((d) => d.period.startsWith(monthKey)), [daily, monthKey]);

  const monthSummary = useMemo(() => {
    const trades = monthData.reduce((a, d) => a + d.tradeCount, 0);
    const profit = monthData.reduce((a, d) => a + d.profit, 0);
    const winningTrades = monthData.reduce((a, d) => a + (d.winningTrades ?? 0), 0);
    const losingTrades = monthData.reduce((a, d) => a + (d.losingTrades ?? 0), 0);
    const decided = winningTrades + losingTrades;
    const winRate = decided > 0 ? (winningTrades / decided) * 100 : 0;
    return { trades, profit, winRate, winningTrades, losingTrades };
  }, [monthData]);

  const maxAbsProfit = useMemo(() => {
    let m = 0;
    for (const d of monthData) m = Math.max(m, Math.abs(d.profit));
    return m;
  }, [monthData]);

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    const result: Date[][] = [];
    let cur = start;
    while (cur <= end) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) week.push(addDays(cur, i));
      result.push(week);
      cur = addDays(cur, 7);
    }
    return result;
  }, [viewMonth]);

  const weekTotals = useMemo(() => {
    return weeks.map((weekDays) => {
      let profit = 0;
      let trades = 0;
      let wins = 0;
      let losses = 0;
      for (const d of weekDays) {
        const row = byDate.get(format(d, "yyyy-MM-dd"));
        if (row) {
          profit += row.profit;
          trades += row.tradeCount;
          wins += row.winningTrades ?? 0;
          losses += row.losingTrades ?? 0;
        }
      }
      return { profit, trades, wins, losses };
    });
  }, [weeks, byDate]);

  const goPrev = () => setMonthOffset((m) => m - 1);
  const goNext = () => setMonthOffset((m) => m + 1);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      {/* Header */}
      <div className="border-b border-border/50 bg-muted/[0.25] p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goPrev}
              className="rounded-full p-1.5 text-muted-foreground transition-all hover:bg-background hover:text-foreground hover:shadow-sm active:scale-95"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
            <div className="min-w-[148px] text-center sm:min-w-[180px]">
              <h3 className="text-[15px] font-semibold tracking-tight text-foreground sm:text-base">
                {format(viewMonth, "MMMM yyyy")}
              </h3>
              <p className="hidden text-[11px] font-medium text-muted-foreground sm:block">
                Daily P&L · tap a day to view trades
              </p>
              <p className="text-[11px] font-medium text-muted-foreground sm:hidden">
                {monthSummary.trades > 0 ? `${monthSummary.trades} trades` : "No trades"}
              </p>
            </div>
            <button
              type="button"
              onClick={goNext}
              className="rounded-full p-1.5 text-muted-foreground transition-all hover:bg-background hover:text-foreground hover:shadow-sm active:scale-95"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4 sm:h-5 sm:w-5" />
            </button>
          </div>

          {/* Month summary pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:justify-end sm:gap-2 sm:overflow-visible">
            {calendarLoading ? (
              <span className="shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border">
                Loading…
              </span>
            ) : monthSummary.trades === 0 ? (
              <span className="hidden shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm ring-1 ring-border sm:inline-flex">
                No trades this month
              </span>
            ) : (
              <>
                {/* Trades pill - clickable */}
                {onMonthClick ? (
                  <button
                    type="button"
                    onClick={() => onMonthClick(startOfDay(startOfMonth(viewMonth)), endOfDay(endOfMonth(viewMonth)))}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-border transition-colors hover:bg-muted"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />
                    {monthSummary.trades} trades
                  </button>
                ) : (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-border">
                    <span className="h-1.5 w-1.5 rounded-full bg-foreground/60" />
                    {monthSummary.trades} trades
                  </span>
                )}

                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background px-2.5 py-1.5 text-xs font-medium shadow-sm ring-1 ring-border">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">{monthSummary.winningTrades}W</span>
                  <span className="mx-0.5 text-border">·</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="text-red-600 dark:text-red-400">{monthSummary.losingTrades}L</span>
                </span>

                <span className="hidden shrink-0 rounded-full bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm ring-1 ring-border sm:inline-flex">
                  {monthSummary.winRate.toFixed(0)}% win
                </span>

                <span
                  className={`inline-flex shrink-0 rounded-full px-3 py-1.5 text-xs font-bold tabular-nums shadow-sm ring-1 ${
                    monthSummary.profit >= 0
                      ? "bg-emerald-500 text-white ring-emerald-600/20 dark:bg-emerald-600"
                      : "bg-red-500 text-white ring-red-600/20 dark:bg-red-600"
                  }`}
                >
                  {formatProfit(monthSummary.profit)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="p-2 sm:p-4">
        <div className="-mx-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:overflow-visible sm:px-0 sm:pb-0">
          <div className="min-w-[720px] sm:min-w-0">
            {/* Weekday header */}
            <div className="mb-2 grid grid-cols-8 gap-1.5 sm:gap-2">
              {WEEKDAY_LABELS.map((label, idx) => {
                const isWeekendLabel = idx === 0 || idx === 6;
                return (
                  <div
                    key={label}
                    className={`py-1 text-center text-[10px] font-semibold uppercase tracking-widest sm:py-1.5 sm:text-[11px] ${
                      isWeekendLabel ? "text-muted-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    <span className="hidden sm:inline">{label}</span>
                    <span className="sm:hidden">{label.slice(0, 2)}</span>
                  </div>
                );
              })}
              <div className="relative py-1 text-center text-[10px] font-bold uppercase tracking-widest text-foreground/60 sm:py-1.5 sm:text-[11px]">
                <span className="absolute inset-y-1 left-0 hidden w-px bg-border sm:block" />
                Week
              </div>
            </div>

            {/* Weeks */}
            <div className="space-y-1.5 sm:space-y-2">
              {weeks.map((weekDays, wi) => {
                const weekTotal = weekTotals[wi];
                const weekIsProfit = weekTotal.profit >= 0;
                const weekHasTrades = weekTotal.trades > 0;

                return (
                  <div key={wi} className="grid grid-cols-8 gap-1.5 sm:gap-2">
                    {weekDays.map((day) => {
                      const key = format(day, "yyyy-MM-dd");
                      const data = byDate.get(key);
                      const isCurrentMonth = isSameMonth(day, viewMonth);
                      const hasData = Boolean(data && data.tradeCount > 0);
                      const isProfit = hasData && (data!.profit ?? 0) >= 0;
                      const dayIsToday = isToday(day);
                      const dayIsWeekend = isWeekend(day);

                      const bgClass = hasData
                        ? `${intensityClass(data!.profit, maxAbsProfit, !!isProfit)} ring-1`
                        : dayIsWeekend && isCurrentMonth
                          ? "bg-muted/40 ring-1 ring-border/30 dark:bg-muted/20"
                          : "bg-muted/20 ring-1 ring-border/20 dark:bg-muted/10";

                      return (
                        <div
                          key={key}
                          role={hasData && onDayClick ? "button" : undefined}
                          tabIndex={hasData && onDayClick ? 0 : undefined}
                          onClick={hasData && onDayClick ? () => onDayClick(day) : undefined}
                          onKeyDown={
                            hasData && onDayClick
                              ? (e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    onDayClick(day);
                                  }
                                }
                              : undefined
                          }
                          className={`group relative flex min-h-[74px] flex-col rounded-xl p-2 transition-all duration-150 sm:min-h-[88px] sm:rounded-2xl sm:p-2.5 ${
                            hasData && onDayClick ? "cursor-pointer hover:shadow-md hover:ring-2 hover:z-10 active:scale-[0.98]" : ""
                          } ${!isCurrentMonth ? "opacity-[0.38]" : ""} ${hasData ? (isProfit ? "hover:ring-emerald-500/40" : "hover:ring-red-500/40") : "hover:bg-muted/40"} ${bgClass} ${dayIsToday ? "!ring-2 !ring-primary/40 !ring-offset-1 ring-offset-card" : ""}`}
                        >
                          {/* left accent bar for PnL days */}
                          {hasData && (
                            <span
                              className={`pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-full ${isProfit ? "bg-emerald-500" : "bg-red-500"}`}
                            />
                          )}

                          {/* day number row */}
                          <div className="flex items-start justify-between gap-1">
                            <span
                              className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold leading-none sm:h-6 sm:min-w-6 sm:text-xs ${
                                dayIsToday
                                  ? "bg-primary text-primary-foreground shadow-sm"
                                  : isCurrentMonth
                                    ? hasData
                                      ? "text-foreground"
                                      : "text-foreground/70"
                                    : "text-muted-foreground"
                              }`}
                            >
                              {format(day, "d")}
                            </span>
                            {hasData && (
                              <span className="hidden rounded-full bg-background/80 px-1.5 py-0.5 text-[9px] font-medium leading-none text-muted-foreground shadow-sm ring-1 ring-border/50 backdrop-blur sm:inline-flex">
                                {data!.tradeCount}×
                              </span>
                            )}
                          </div>

                          {/* PnL */}
                          {hasData ? (
                            <div className="mt-1.5 flex flex-1 flex-col sm:mt-2">
                              <span
                                className={`text-[12px] font-bold leading-none tracking-tight tabular-nums sm:text-[13.5px] ${
                                  isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                                }`}
                              >
                                <span className="sm:hidden">{formatProfitCompact(data!.profit)}</span>
                                <span className="hidden sm:inline">{formatProfit(data!.profit)}</span>
                              </span>

                              <span className="mt-1 hidden text-[10px] font-medium leading-none text-muted-foreground sm:block">
                                {data!.tradeCount} trade{data!.tradeCount !== 1 ? "s" : ""}
                              </span>
                              <span className="mt-0.5 text-[10px] font-medium leading-none text-muted-foreground sm:hidden">
                                {data!.tradeCount} tr
                              </span>

                              {/* W / L dots */}
                              {(data!.winningTrades ?? 0) > 0 || (data!.losingTrades ?? 0) > 0 ? (
                                <span className="mt-auto flex items-center gap-1 pt-1.5 text-[10px] font-medium leading-none">
                                  {(data!.winningTrades ?? 0) > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                      <span className="h-1 w-1 rounded-full bg-emerald-500" />
                                      {data!.winningTrades}W
                                    </span>
                                  )}
                                  {(data!.winningTrades ?? 0) > 0 && (data!.losingTrades ?? 0) > 0 && (
                                    <span className="text-border">·</span>
                                  )}
                                  {(data!.losingTrades ?? 0) > 0 && (
                                    <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
                                      <span className="h-1 w-1 rounded-full bg-red-500" />
                                      {data!.losingTrades}L
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="mt-auto pt-1" />
                              )}
                            </div>
                          ) : (
                            <span className="mt-2 text-[11px] font-medium leading-none text-muted-foreground/40 sm:mt-3 sm:text-xs">—</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Week total column - distinct */}
                    <div className="relative pl-1 sm:pl-2">
                      <span className="pointer-events-none absolute inset-y-0 left-0 w-px bg-border/60" />
                      {weekHasTrades && onWeekClick ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onWeekClick(startOfDay(weekDays[0]), endOfDay(weekDays[6]));
                          }}
                          className={`flex min-h-[74px] w-full flex-col justify-center rounded-xl p-2 text-left ring-1 transition-all hover:shadow-md hover:ring-2 hover:z-10 active:scale-[0.98] sm:min-h-[88px] sm:rounded-2xl sm:p-2.5 ${
                            weekIsProfit
                              ? "bg-emerald-500/[0.06] ring-emerald-500/15 hover:bg-emerald-500/[0.10] hover:ring-emerald-500/30 dark:bg-emerald-500/[0.10]"
                              : "bg-red-500/[0.06] ring-red-500/15 hover:bg-red-500/[0.10] hover:ring-red-500/30 dark:bg-red-500/[0.10]"
                          }`}
                        >
                          <span
                            className={`text-[11px] font-bold leading-none tabular-nums sm:text-[12.5px] ${
                              weekIsProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            <span className="sm:hidden">{formatProfitCompact(weekTotal.profit)}</span>
                            <span className="hidden sm:inline">{formatProfit(weekTotal.profit)}</span>
                          </span>
                          <span className="mt-1 text-[10px] font-medium leading-none text-muted-foreground">
                            {weekTotal.trades} tr
                            <span className="hidden sm:inline">ades</span>
                          </span>
                          {(weekTotal.wins > 0 || weekTotal.losses > 0) && (
                            <span className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-medium leading-none">
                              {weekTotal.wins > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                                  <span className="h-1 w-1 rounded-full bg-emerald-500" />
                                  {weekTotal.wins}W
                                </span>
                              )}
                              {weekTotal.wins > 0 && weekTotal.losses > 0 && <span className="text-border">·</span>}
                              {weekTotal.losses > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-red-600 dark:text-red-400">
                                  <span className="h-1 w-1 rounded-full bg-red-500" />
                                  {weekTotal.losses}L
                                </span>
                              )}
                            </span>
                          )}
                        </button>
                      ) : weekHasTrades ? (
                        <div
                          className={`flex min-h-[74px] w-full flex-col justify-center rounded-xl p-2 ring-1 sm:min-h-[88px] sm:rounded-2xl sm:p-2.5 ${
                            weekIsProfit
                              ? "bg-emerald-500/[0.06] ring-emerald-500/15 dark:bg-emerald-500/[0.10]"
                              : "bg-red-500/[0.06] ring-red-500/15 dark:bg-red-500/[0.10]"
                          }`}
                        >
                          <span
                            className={`text-[11px] font-bold tabular-nums sm:text-[12.5px] ${weekIsProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {formatProfit(weekTotal.profit)}
                          </span>
                          <span className="mt-1 text-[10px] text-muted-foreground">{weekTotal.trades} trades</span>
                        </div>
                      ) : (
                        <div className="flex min-h-[74px] w-full items-center justify-center rounded-xl bg-muted/20 p-2 ring-1 ring-border/20 sm:min-h-[88px] sm:rounded-2xl dark:bg-muted/10">
                          <span className="text-xs font-medium text-muted-foreground/40">—</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* footer legend */}
            <div className="mt-3 hidden items-center justify-between border-t border-border/40 pt-3 sm:flex">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Profit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-red-500" /> Loss
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-primary" /> Today
                </span>
                <span className="text-border">·</span>
                <span>Intensity = magnitude of P&L</span>
              </div>
              <span className="text-[11px] text-muted-foreground">Click any day or week total to see trades</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
