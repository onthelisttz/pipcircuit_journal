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
} from "date-fns";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
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
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function formatProfitCompact(n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) {
    const v = abs >= 10000 ? abs / 1000 : Number((abs / 1000).toFixed(1));
    return `${sign}$${v}k`;
  }
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(2)}`;
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
  const { daily, loading: calendarLoading } = useCalendarMonthReturns(accountId, viewMonth, symbols, direction, advancedQuery);

  const byDate = useMemo(() => {
    const m = new Map<string, DayReturn>();
    for (const d of daily) m.set(d.period, d);
    return m;
  }, [daily]);

  const monthKey = format(viewMonth, "yyyy-MM");
  const monthData = useMemo(() => daily.filter((d) => d.period.startsWith(monthKey)), [daily, monthKey]);

  const monthSummary = useMemo(() => {
    const trades = monthData.reduce((a, d) => a + d.tradeCount, 0);
    const profit = monthData.reduce((a, d) => a + d.profit, 0);
    const w = monthData.reduce((a, d) => a + (d.winningTrades ?? 0), 0);
    const l = monthData.reduce((a, d) => a + (d.losingTrades ?? 0), 0);
    const winRate = w + l > 0 ? (w / (w + l)) * 100 : 0;
    return { trades, profit, winRate, w, l };
  }, [monthData]);

  const weeks = useMemo(() => {
    const s = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const e = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    const r: Date[][] = [];
    let cur = s;
    while (cur <= e) {
      const w: Date[] = [];
      for (let i = 0; i < 7; i++) w.push(addDays(cur, i));
      r.push(w);
      cur = addDays(cur, 7);
    }
    return r;
  }, [viewMonth]);

  const weekTotals = useMemo(
    () =>
      weeks.map((wd) => {
        let profit = 0, trades = 0, wins = 0, losses = 0;
        for (const d of wd) {
          const row = byDate.get(format(d, "yyyy-MM-dd"));
          if (row) {
            profit += row.profit; trades += row.tradeCount;
            wins += row.winningTrades ?? 0; losses += row.losingTrades ?? 0;
          }
        }
        return { profit, trades, wins, losses };
      }),
    [weeks, byDate]
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {/* ── Header ── */}
      <div className="border-b border-border bg-card px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="hidden h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary sm:flex">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-none tracking-tight text-foreground sm:text-[15px]">Performance Calendar</h3>
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block">Daily breakdown · click any day or week to view trades</p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">Daily P&L</p>
            </div>
          </div>

          <div className="flex items-center rounded-full border border-border bg-muted/40 p-1">
            <button type="button" onClick={() => setMonthOffset((m) => m - 1)} className="rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[118px] px-2 text-center text-sm font-semibold tabular-nums text-foreground sm:min-w-[132px]">{format(viewMonth, "MMMM yyyy")}</span>
            <button type="button" onClick={() => setMonthOffset((m) => m + 1)} className="rounded-full p-1.5 text-muted-foreground hover:bg-background hover:text-foreground hover:shadow-sm" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Month summary bar */}
        <div className="mt-4 grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          {calendarLoading ? (
            <span className="col-span-4 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2.5 text-center text-xs text-muted-foreground">Loading…</span>
          ) : monthSummary.trades === 0 ? (
            <span className="col-span-4 rounded-xl border border-dashed border-border bg-muted/20 px-3 py-2.5 text-center text-xs text-muted-foreground">No trades this month</span>
          ) : (
            <>
              {onMonthClick ? (
                <button type="button" onClick={() => onMonthClick(startOfDay(startOfMonth(viewMonth)), endOfDay(endOfMonth(viewMonth)))} className="rounded-xl border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/50 sm:min-w-[110px]">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trades</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{monthSummary.trades}</div>
                </button>
              ) : (
                <div className="rounded-xl border border-border bg-background px-3 py-2.5 sm:min-w-[110px]">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trades</div>
                  <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{monthSummary.trades}</div>
                </div>
              )}
              <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">W / L</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums">
                  <span className="text-emerald-600">{monthSummary.w}W</span> <span className="font-normal text-muted-foreground">·</span> <span className="text-red-600">{monthSummary.l}L</span>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-background px-3 py-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Win rate</div>
                <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{monthSummary.winRate.toFixed(0)}%</div>
              </div>
              <div className={`rounded-xl border px-3 py-2.5 sm:ml-auto sm:min-w-[120px] ${monthSummary.profit >= 0 ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"}`}>
                <div className={`text-[10px] font-semibold uppercase tracking-widest ${monthSummary.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>Net P&L</div>
                <div className={`mt-0.5 text-sm font-bold tabular-nums ${monthSummary.profit >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>{formatProfit(monthSummary.profit)}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      <div className="bg-muted/15 p-2 sm:p-3">
        <div className="-mx-2 overflow-x-auto px-2 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
          <div className="min-w-[760px] sm:min-w-0">
            {/* weekday labels */}
            <div className="mb-2 grid grid-cols-8 gap-2">
              {WEEKDAY_LABELS.map((l) => (
                <div key={l} className="py-1 text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
                  {l}
                </div>
              ))}
              <div className="rounded-lg bg-foreground py-1.5 text-center text-[10px] font-bold uppercase tracking-widest text-background">Week</div>
            </div>

            <div className="space-y-2">
              {weeks.map((wd, wi) => {
                const wt = weekTotals[wi];
                const hasWeek = wt.trades > 0;
                const weekProfit = wt.profit >= 0;
                return (
                  <div key={wi} className="grid grid-cols-8 gap-2">
                    {wd.map((day) => {
                      const key = format(day, "yyyy-MM-dd");
                      const data = byDate.get(key);
                      const inMonth = isSameMonth(day, viewMonth);
                      const hasData = Boolean(data && data.tradeCount > 0);
                      const isProfit = hasData && (data!.profit ?? 0) >= 0;
                      const today = isToday(day);

                      let cell = "bg-card border-border hover:border-border hover:shadow-sm";
                      if (!inMonth) cell = "bg-muted/10 border-border/40 opacity-40";
                      else if (hasData && isProfit) cell = "bg-emerald-50 border-emerald-200 hover:border-emerald-300 hover:shadow-sm dark:bg-emerald-950/20 dark:border-emerald-900";
                      else if (hasData && !isProfit) cell = "bg-red-50 border-red-200 hover:border-red-300 hover:shadow-sm dark:bg-red-950/20 dark:border-red-900";

                      return (
                        <div
                          key={key}
                          role={hasData && onDayClick ? "button" : undefined}
                          tabIndex={hasData && onDayClick ? 0 : undefined}
                          onClick={hasData && onDayClick ? () => onDayClick(day) : undefined}
                          onKeyDown={hasData && onDayClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onDayClick(day); } } : undefined}
                          className={`group relative flex min-h-[84px] flex-col rounded-xl border p-2.5 transition-all sm:min-h-[96px] ${cell} ${hasData && onDayClick ? "cursor-pointer active:scale-[0.98]" : ""} ${today ? "ring-2 ring-primary ring-offset-2 ring-offset-card" : ""}`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-semibold ${today ? "bg-primary text-primary-foreground" : inMonth ? "bg-muted text-foreground" : "bg-transparent text-muted-foreground"} ${hasData && inMonth && !today ? "bg-background shadow-sm ring-1 ring-border" : ""}`}>
                              {format(day, "d")}
                            </span>
                            {hasData && <span className="rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">{data!.tradeCount}</span>}
                          </div>

                          {hasData ? (
                            <div className="mt-2 flex flex-1 flex-col">
                              <div className={`text-[13px] font-bold leading-none tracking-tight tabular-nums sm:text-[14px] ${isProfit ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                                <span className="sm:hidden">{formatProfitCompact(data!.profit)}</span>
                                <span className="hidden sm:inline">{formatProfit(data!.profit)}</span>
                              </div>
                              <div className="mt-1 text-[10px] font-medium text-muted-foreground">{data!.tradeCount} trade{data!.tradeCount !== 1 ? "s" : ""}</div>
                              <div className="mt-auto flex items-center gap-1 pt-2 text-[10px] leading-none">
                                {(data!.winningTrades ?? 0) > 0 && <span className="rounded-full bg-emerald-600 px-1.5 py-0.5 font-semibold text-white">{data!.winningTrades}W</span>}
                                {(data!.losingTrades ?? 0) > 0 && <span className="rounded-full bg-red-600 px-1.5 py-0.5 font-semibold text-white">{data!.losingTrades}L</span>}
                                {(data!.winningTrades ?? 0) === 0 && (data!.losingTrades ?? 0) === 0 && <span className="text-muted-foreground/50">—</span>}
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-1 items-center justify-center">
                              <span className="text-sm font-medium text-muted-foreground/30">—</span>
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Week total */}
                    <div className="flex">
                      {hasWeek && onWeekClick ? (
                        <button
                          type="button"
                          onClick={() => onWeekClick(startOfDay(wd[0]), endOfDay(wd[6]))}
                          className={`flex w-full flex-col items-center justify-center rounded-xl border p-2 text-center transition-all hover:shadow-sm active:scale-[0.98] sm:p-2.5 ${weekProfit ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300" : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"}`}
                        >
                          <span className="text-xs font-bold tabular-nums sm:text-[13px]">
                            <span className="sm:hidden">{formatProfitCompact(wt.profit)}</span>
                            <span className="hidden sm:inline">{formatProfit(wt.profit)}</span>
                          </span>
                          <span className="mt-1 rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">{wt.trades} trades</span>
                          <span className="mt-1 flex gap-1">
                            {wt.wins > 0 && <span className="rounded-full bg-emerald-600 px-1 py-0.5 text-[9px] font-bold text-white">{wt.wins}W</span>}
                            {wt.losses > 0 && <span className="rounded-full bg-red-600 px-1 py-0.5 text-[9px] font-bold text-white">{wt.losses}L</span>}
                          </span>
                        </button>
                      ) : hasWeek ? (
                        <div className={`flex w-full flex-col items-center justify-center rounded-xl border p-2 text-center sm:p-2.5 ${weekProfit ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30"}`}>
                          <span className={`text-xs font-bold tabular-nums ${weekProfit ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}>{formatProfit(wt.profit)}</span>
                          <span className="mt-1 text-[10px] text-muted-foreground">{wt.trades} trades</span>
                        </div>
                      ) : (
                        <div className="flex w-full items-center justify-center rounded-xl border border-dashed border-border bg-card/50">
                          <span className="text-sm text-muted-foreground/30">—</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
