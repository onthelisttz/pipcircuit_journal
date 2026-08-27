"use client";

import { Fragment, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  isWeekend,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarMonthReturns } from "@ui/hooks";
import { cn } from "@lib/utils";
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

function formatProfit(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatProfitCompact(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);

  if (abs >= 1000) {
    const amount = abs >= 10000 ? (abs / 1000).toFixed(0) : (abs / 1000).toFixed(1);
    return `${sign}$${amount}k`;
  }

  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  return `${sign}$${abs.toFixed(1)}`;
}

function getIntensity(profit: number, maxAbsProfit: number) {
  if (profit === 0 || maxAbsProfit === 0) return 0;
  return Math.max(0.18, Math.min(1, Math.abs(profit) / maxAbsProfit));
}

function getProfitTone(profit: number) {
  if (profit > 0) return "profit";
  if (profit < 0) return "loss";
  return "flat";
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
    for (const day of daily) map.set(day.period, day);
    return map;
  }, [daily]);

  const monthKey = format(viewMonth, "yyyy-MM");
  const monthData = useMemo(() => daily.filter((day) => day.period.startsWith(monthKey)), [daily, monthKey]);

  const monthSummary = useMemo(() => {
    const trades = monthData.reduce((total, day) => total + day.tradeCount, 0);
    const profit = monthData.reduce((total, day) => total + day.profit, 0);
    const winningTrades = monthData.reduce((total, day) => total + (day.winningTrades ?? 0), 0);
    const losingTrades = monthData.reduce((total, day) => total + (day.losingTrades ?? 0), 0);
    const activeDays = monthData.filter((day) => day.tradeCount > 0).length;
    const decidedTrades = winningTrades + losingTrades;
    const winRate = decidedTrades > 0 ? (winningTrades / decidedTrades) * 100 : 0;
    const averageDay = activeDays > 0 ? profit / activeDays : 0;
    const bestDay = monthData.reduce<number | null>(
      (best, day) => (best == null || day.profit > best ? day.profit : best),
      null
    );
    const worstDay = monthData.reduce<number | null>(
      (worst, day) => (worst == null || day.profit < worst ? day.profit : worst),
      null
    );

    return {
      activeDays,
      averageDay,
      bestDay,
      losingTrades,
      profit,
      trades,
      winRate,
      winningTrades,
      worstDay,
    };
  }, [monthData]);

  const maxAbsProfit = useMemo(
    () => monthData.reduce((max, day) => Math.max(max, Math.abs(day.profit)), 0),
    [monthData]
  );

  const weeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(viewMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(viewMonth), { weekStartsOn: 0 });
    const result: Date[][] = [];
    let cursor = start;

    while (cursor <= end) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) week.push(addDays(cursor, i));
      result.push(week);
      cursor = addDays(cursor, 7);
    }

    return result;
  }, [viewMonth]);

  const weekTotals = useMemo(
    () =>
      weeks.map((weekDays) => {
        let profit = 0;
        let trades = 0;
        let wins = 0;
        let losses = 0;

        for (const day of weekDays) {
          const row = byDate.get(format(day, "yyyy-MM-dd"));
          if (!row) continue;
          profit += row.profit;
          trades += row.tradeCount;
          wins += row.winningTrades ?? 0;
          losses += row.losingTrades ?? 0;
        }

        return { losses, profit, trades, wins };
      }),
    [byDate, weeks]
  );

  const openMonthTrades = () => {
    onMonthClick?.(startOfDay(startOfMonth(viewMonth)), endOfDay(endOfMonth(viewMonth)));
  };

  const canOpenMonth = Boolean(onMonthClick && monthSummary.trades > 0);
  const netTone = getProfitTone(monthSummary.profit);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border bg-gradient-to-b from-background to-muted/20 px-4 py-4 sm:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary shadow-sm">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">Performance Calendar</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {calendarLoading
                  ? "Loading daily P&L"
                  : monthSummary.trades > 0
                    ? `${monthSummary.activeDays} trading days, ${monthSummary.winningTrades}W / ${monthSummary.losingTrades}L`
                    : "No trades recorded for this month"}
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <div
              className={cn(
                "rounded-lg border px-4 py-3 md:min-w-[180px]",
                netTone === "profit" && "border-emerald-500/25 bg-emerald-500/[0.08]",
                netTone === "loss" && "border-red-500/25 bg-red-500/[0.08]",
                netTone === "flat" && "border-border bg-card"
              )}
            >
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">Month Net</span>
              <div
                className={cn(
                  "mt-1 text-2xl font-bold leading-none tabular-nums",
                  netTone === "profit" && "text-emerald-600 dark:text-emerald-400",
                  netTone === "loss" && "text-red-600 dark:text-red-400",
                  netTone === "flat" && "text-foreground"
                )}
              >
                {calendarLoading ? "..." : formatProfit(monthSummary.profit)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <MonthMetric label="Trades" value={calendarLoading ? "..." : monthSummary.trades.toString()} />
              <MonthMetric label="Win Rate" value={calendarLoading ? "..." : `${monthSummary.winRate.toFixed(0)}%`} />
              <MonthMetric label="Avg Day" value={calendarLoading ? "..." : formatProfitCompact(monthSummary.averageDay)} />
              <MonthMetric
                label="Range"
                value={
                  calendarLoading
                    ? "..."
                    : `${formatProfitCompact(monthSummary.bestDay ?? 0)} / ${formatProfitCompact(monthSummary.worstDay ?? 0)}`
                }
              />
            </div>

            <div className="flex h-10 items-center justify-between rounded-lg border border-border bg-card p-1 md:w-[226px]">
              <button
                type="button"
                onClick={() => setMonthOffset((month) => month - 1)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="px-2 text-sm font-semibold tabular-nums text-foreground">
                {format(viewMonth, "MMMM yyyy")}
              </span>
              <button
                type="button"
                onClick={() => setMonthOffset((month) => month + 1)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="min-w-[800px]">
            <div className="grid grid-cols-[repeat(7,minmax(88px,1fr))_112px] gap-px overflow-hidden rounded-lg border border-border bg-border">
              {WEEKDAY_LABELS.map((label, index) => (
                <div
                  key={label}
                  className={cn(
                    "bg-muted/55 px-3 py-2 text-center text-[10px] font-semibold uppercase text-muted-foreground",
                    (index === 0 || index === 6) && "bg-muted/35 text-muted-foreground/75"
                  )}
                >
                  {label}
                </div>
              ))}
              <div className="bg-muted/70 px-3 py-2 text-center text-[10px] font-semibold uppercase text-foreground/70">
                Week
              </div>

              {weeks.map((weekDays, weekIndex) => {
                const weekTotal = weekTotals[weekIndex];
                const hasWeekTrades = weekTotal.trades > 0;
                const weekTone = getProfitTone(weekTotal.profit);

                return (
                  <Fragment key={weekIndex}>
                    {weekDays.map((day) => {
                      const key = format(day, "yyyy-MM-dd");
                      const data = byDate.get(key);
                      const isCurrentMonth = isSameMonth(day, viewMonth);
                      const hasTrades = Boolean(data && data.tradeCount > 0);
                      const tone = getProfitTone(data?.profit ?? 0);
                      const dayIsToday = isToday(day);
                      const dayIsWeekend = isWeekend(day);
                      const intensity = getIntensity(data?.profit ?? 0, maxAbsProfit);

                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={!hasTrades || !onDayClick}
                          onClick={() => onDayClick?.(day)}
                          className={cn(
                            "relative flex h-[104px] flex-col overflow-hidden bg-card p-2.5 text-left outline-none transition-all focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                            hasTrades && "hover:z-10 hover:shadow-md",
                            !hasTrades && "cursor-default",
                            !isCurrentMonth && "bg-muted/15 text-muted-foreground opacity-45",
                            isCurrentMonth && !hasTrades && dayIsWeekend && "bg-muted/25",
                            dayIsToday && "z-10 ring-2 ring-primary/50 ring-inset"
                          )}
                        >
                          {hasTrades && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute inset-x-0 bottom-0",
                                tone === "profit" && "bg-emerald-500",
                                tone === "loss" && "bg-red-500",
                                tone === "flat" && "bg-muted-foreground"
                              )}
                              style={{
                                height: `${Math.round(intensity * 100)}%`,
                                opacity: 0.08 + intensity * 0.18,
                              }}
                            />
                          )}
                          <span
                            aria-hidden="true"
                            className={cn(
                              "absolute left-0 top-0 h-full w-1 opacity-0",
                              hasTrades && tone === "profit" && "bg-emerald-500 opacity-100",
                              hasTrades && tone === "loss" && "bg-red-500 opacity-100",
                              hasTrades && tone === "flat" && "bg-muted-foreground opacity-60"
                            )}
                          />

                          <div className="relative z-10 flex items-start justify-between gap-2">
                            <div>
                              <span
                                className={cn(
                                  "inline-flex h-6 min-w-6 items-center justify-center rounded-md px-1 text-xs font-semibold",
                                  dayIsToday ? "bg-primary text-primary-foreground" : "text-foreground",
                                  !isCurrentMonth && "text-muted-foreground"
                                )}
                              >
                                {format(day, "d")}
                              </span>
                              {dayIsToday && <span className="ml-1 text-[10px] font-semibold text-primary">Today</span>}
                            </div>
                            {hasTrades && (
                              <span className="rounded-md bg-background/90 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground ring-1 ring-border">
                                {data!.tradeCount}x
                              </span>
                            )}
                          </div>

                          <div className="relative z-10 mt-auto">
                            {hasTrades ? (
                              <>
                                <div
                                  className={cn(
                                    "text-[15px] font-bold leading-none tabular-nums",
                                    tone === "profit" && "text-emerald-600 dark:text-emerald-400",
                                    tone === "loss" && "text-red-600 dark:text-red-400",
                                    tone === "flat" && "text-foreground"
                                  )}
                                >
                                  <span className="lg:hidden">{formatProfitCompact(data!.profit)}</span>
                                  <span className="hidden lg:inline">{formatProfit(data!.profit)}</span>
                                </div>
                                <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold">
                                  <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
                                    {data!.winningTrades ?? 0}W
                                  </span>
                                  <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
                                    {data!.losingTrades ?? 0}L
                                  </span>
                                </div>
                              </>
                            ) : (
                              <span className="text-[11px] font-medium text-muted-foreground/45">No trades</span>
                            )}
                          </div>
                        </button>
                      );
                    })}

                    {hasWeekTrades && onWeekClick ? (
                      <button
                        type="button"
                        onClick={() => onWeekClick(startOfDay(weekDays[0]), endOfDay(weekDays[6]))}
                        className={cn(
                          "flex h-[104px] flex-col justify-between bg-background p-2.5 text-left outline-none transition-all hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring",
                          weekTone === "profit" && "bg-emerald-500/[0.08]",
                          weekTone === "loss" && "bg-red-500/[0.08]"
                        )}
                      >
                        <WeekTotalContent weekIndex={weekIndex} weekTone={weekTone} weekTotal={weekTotal} />
                      </button>
                    ) : (
                      <div
                        className={cn(
                          "flex h-[104px] flex-col justify-between bg-background p-2.5",
                          hasWeekTrades && weekTone === "profit" && "bg-emerald-500/[0.08]",
                          hasWeekTrades && weekTone === "loss" && "bg-red-500/[0.08]",
                          !hasWeekTrades && "bg-muted/20"
                        )}
                      >
                        {hasWeekTrades ? (
                          <WeekTotalContent weekIndex={weekIndex} weekTone={weekTone} weekTotal={weekTotal} />
                        ) : (
                          <span className="m-auto text-xs font-medium text-muted-foreground/45">Empty</span>
                        )}
                      </div>
                    )}
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-5 rounded-full bg-emerald-500" />
              Profit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-5 rounded-full bg-red-500" />
              Loss
            </span>
            <span>Stronger fill means a larger P&L day</span>
          </div>
          {canOpenMonth ? (
            <button
              type="button"
              onClick={openMonthTrades}
              className="rounded-md px-2 py-1 font-medium text-foreground transition-colors hover:bg-accent"
            >
              View month trades
            </button>
          ) : (
            <span>Daily trade performance</span>
          )}
        </div>
      </div>
    </section>
  );
}

function MonthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[92px] rounded-lg border border-border bg-card px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
      <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function WeekTotalContent({
  weekIndex,
  weekTone,
  weekTotal,
}: {
  weekIndex: number;
  weekTone: "profit" | "loss" | "flat";
  weekTotal: { losses: number; profit: number; trades: number; wins: number };
}) {
  return (
    <>
      <span className="text-[10px] font-semibold uppercase text-muted-foreground">Week {weekIndex + 1}</span>
      <span
        className={cn(
          "text-[15px] font-bold leading-none tabular-nums",
          weekTone === "profit" && "text-emerald-600 dark:text-emerald-400",
          weekTone === "loss" && "text-red-600 dark:text-red-400",
          weekTone === "flat" && "text-foreground"
        )}
      >
        <span className="lg:hidden">{formatProfitCompact(weekTotal.profit)}</span>
        <span className="hidden lg:inline">{formatProfit(weekTotal.profit)}</span>
      </span>
      <span className="text-[10px] font-medium text-muted-foreground">{weekTotal.trades} trades</span>
      <span className="flex gap-1.5 text-[10px] font-semibold">
        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-600 dark:text-emerald-400">
          {weekTotal.wins}W
        </span>
        <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-600 dark:text-red-400">
          {weekTotal.losses}L
        </span>
      </span>
    </>
  );
}
