"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendarMonthReturns, useTradesByQuery } from "@ui/hooks";
import { useTradePanel } from "@ui/providers";
import { cn } from "@lib/utils";
import type { Direction } from "@domain/enums";
import type { TradeQuery } from "@application/ports/repositories";

type Filter = "all" | "wins" | "losses";

interface DayReturn {
  period: string;
  profit: number;
  tradeCount: number;
  winning: number;
  losing: number;
  winningTrades?: number;
  losingTrades?: number;
}

interface CurvePoint {
  date: string;
  balance: number;
  hasData: boolean;
  day?: DayReturn;
}

interface PerformanceCalendarProps {
  accountId: string;
  symbols: string[];
  direction: Direction | "Both";
  advancedQuery?: Pick<TradeQuery, "ratingValues" | "mindsets" | "tagIds">;
  initialMonth?: Date;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatMoney(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const amount = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${sign}$${amount}`;
}

function formatSigned(value: number, decimals = 2): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}`;
}

function WinRateDonut({ winRate }: { winRate: number }) {
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, winRate));
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg width="54" height="54" viewBox="0 0 54 54" className="shrink-0" aria-label={`Win rate ${clamped.toFixed(0)}%`}>
      <circle cx="27" cy="27" r={radius} fill="none" className="stroke-border" strokeWidth="6" />
      <circle
        cx="27"
        cy="27"
        r={radius}
        fill="none"
        className="stroke-primary"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 27 27)"
      />
      <text x="27" y="31" textAnchor="middle" fontSize="13" fontWeight="800" className="fill-foreground">
        {clamped.toFixed(0)}%
      </text>
    </svg>
  );
}

interface BalanceTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: CurvePoint }>;
  onOpen: (dateKey: string, filter: Filter) => void;
}

function BalanceTooltip({ active, payload, onOpen }: BalanceTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point?.hasData || !point.day) return null;

  const day = point.day;
  const winning = day.winning ?? 0;
  const losing = day.losing ?? 0;
  const net = day.profit ?? winning + losing;
  const winCount = day.winningTrades ?? 0;
  const lossCount = day.losingTrades ?? 0;
  const total = day.tradeCount ?? 0;
  const dateKey = point.date;

  return (
    <div
      className="min-w-[200px] rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
      style={{ pointerEvents: "auto" }}
    >
      <p className="mb-1.5 font-semibold">{format(new Date(`${dateKey}T00:00:00`), "MMM d, yyyy")}</p>
      <button
        type="button"
        onClick={() => onOpen(dateKey, "wins")}
        className="flex w-full items-center gap-2 text-left text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400"
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-current" />
        Wins: {winCount} &middot; {formatSigned(winning)}$
      </button>
      <button
        type="button"
        onClick={() => onOpen(dateKey, "losses")}
        className="mt-1 flex w-full items-center gap-2 text-left text-red-600 transition-opacity hover:opacity-80 dark:text-red-400"
      >
        <span className="inline-block h-2 w-2 shrink-0 rounded-sm bg-current" />
        Losses: {lossCount} &middot; {formatSigned(losing)}$
      </button>
      <div className="mt-1.5 border-t border-border pt-1.5">
        <button
          type="button"
          onClick={() => onOpen(dateKey, "all")}
          className="w-full text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          {total} trades
          <span className={cn("ml-1.5 font-semibold", net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            P&amp;L: {net >= 0 ? "+" : ""}
            {net.toFixed(2)}$
          </span>
        </button>
      </div>
    </div>
  );
}

function TrendSparkline({ trend, isProfit }: { trend?: number[]; isProfit: boolean }) {
  if (!trend || trend.length < 2) return null;

  const width = 100;
  const height = 20;
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const range = max - min || 1;
  const stepX = width / (trend.length - 1);
  const y = (value: number) => height - 3 - ((value - min) / range) * (height - 6);
  const points = trend.map((value, index) => `${(index * stepX).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[20px] w-full" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(isProfit ? "stroke-emerald-500" : "stroke-red-500")}
        opacity={0.85}
      />
    </svg>
  );
}

interface DayCellProps {
  date: Date;
  data?: DayReturn;
  trend?: number[];
  inMonth: boolean;
  today: boolean;
  weekend: boolean;
  onOpen: (filter: Filter) => void;
}

function DayCell({ date, data, trend, inMonth, today, weekend, onOpen }: DayCellProps) {
  const hasTrades = Boolean(data && data.tradeCount > 0);
  const isProfit = hasTrades && (data!.profit >= 0);
  const winning = data?.winning ?? 0;
  const losing = data?.losing ?? 0;

  return (
    <div
      className={cn(
        "relative flex min-h-[104px] flex-col rounded-[13px] border bg-card p-2 transition-all sm:min-h-[112px] sm:p-2.5",
        !inMonth && "border-transparent opacity-30",
        inMonth && !hasTrades && "border-border",
        inMonth &&
          hasTrades &&
          isProfit &&
          "border-emerald-500/40 bg-emerald-500/[0.08] hover:-translate-y-px hover:border-emerald-500 hover:bg-emerald-500/[0.14] hover:shadow-lg",
        inMonth &&
          hasTrades &&
          !isProfit &&
          "border-red-500/40 bg-red-500/[0.08] hover:-translate-y-px hover:border-red-500 hover:bg-red-500/[0.14] hover:shadow-lg"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex items-center gap-1 text-[11px] font-semibold text-foreground",
            !inMonth && "text-muted-foreground"
          )}
        >
          <CalendarDays className="h-3 w-3 text-muted-foreground" />
          {today ? (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {format(date, "d")}
            </span>
          ) : (
            <span>{format(date, "d")}</span>
          )}
          {today && <span className="text-[10px] font-bold text-primary">Today</span>}
        </span>
        {hasTrades && (
          <button
            type="button"
            title="View total trades"
            onClick={() => onOpen("all")}
            className="rounded-full border border-border bg-card/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
          >
            {data!.tradeCount} tr
          </button>
        )}
      </div>

      {hasTrades ? (
        <>
          <button
            type="button"
            title="View total trades"
            onClick={() => onOpen("all")}
            className={cn(
              "flex flex-1 items-center justify-center text-center text-base font-extrabold leading-none tabular-nums transition-opacity hover:opacity-80",
              isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}
          >
            {formatMoney(data!.profit)}
          </button>
          <div className="mt-auto">
            <div className="flex items-center justify-between gap-1.5">
              {(data!.winningTrades ?? 0) > 0 && (
                <button
                  type="button"
                  title="View winning trades"
                  onClick={() => onOpen("wins")}
                  className="text-[10.5px] font-semibold text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400"
                >
                  {data!.winningTrades}w <b className="font-bold tabular-nums">{formatSigned(winning)}</b>
                </button>
              )}
              {(data!.losingTrades ?? 0) > 0 && (
                <button
                  type="button"
                  title="View losing trades"
                  onClick={() => onOpen("losses")}
                  className="text-[10.5px] font-semibold text-red-600 transition-opacity hover:opacity-80 dark:text-red-400"
                >
                  {data!.losingTrades}l <b className="font-bold tabular-nums">{formatSigned(losing)}</b>
                </button>
              )}
            </div>
            <span
              aria-hidden="true"
              className={cn("mt-1.5 block h-px w-full", isProfit ? "bg-emerald-500/40" : "bg-red-500/40")}
            />
            <div className="mt-1">
              <TrendSparkline trend={trend} isProfit={isProfit} />
            </div>
          </div>
        </>
      ) : (
        <span className="mt-auto text-[11px] font-medium text-muted-foreground/50">
          {inMonth && weekend ? "closed" : ""}
        </span>
      )}
    </div>
  );
}

interface WeekCellProps {
  weekIndex: number;
  total: { profit: number; trades: number; wins: number; losses: number; wonAmount: number; lostAmount: number };
  trend?: number[];
  hasTrades: boolean;
  onOpen: (filter: Filter) => void;
}

function WeekCell({ weekIndex, total, trend, hasTrades, onOpen }: WeekCellProps) {
  const isProfit = hasTrades && total.profit >= 0;

  return (
    <div
      className={cn(
        "relative flex min-h-[104px] flex-col rounded-[13px] border p-2 transition-all sm:min-h-[112px] sm:p-2.5",
        "border-primary/20 bg-primary/[0.05]",
        hasTrades &&
          isProfit &&
          "border-emerald-500/40 bg-emerald-500/[0.08] hover:-translate-y-px hover:border-emerald-500 hover:bg-emerald-500/[0.14] hover:shadow-lg",
        hasTrades &&
          !isProfit &&
          "border-red-500/40 bg-red-500/[0.08] hover:-translate-y-px hover:border-red-500 hover:bg-red-500/[0.14] hover:shadow-lg",
        hasTrades && "hover:border-primary/40 hover:bg-primary/[0.10]",
        !hasTrades && "border-border bg-muted/10"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1 text-[11px] font-bold text-primary">
          <CalendarDays className="h-3 w-3 text-primary/70" />
          Wk {weekIndex + 1}
        </span>
        {hasTrades && (
          <button
            type="button"
            title="View total trades"
            onClick={() => onOpen("all")}
            className="rounded-full border border-border bg-card/70 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
          >
            {total.trades} tr
          </button>
        )}
      </div>

      {hasTrades ? (
        <>
          <button
            type="button"
            title="View total trades"
            onClick={() => onOpen("all")}
            className={cn(
              "flex flex-1 items-center justify-center text-center text-base font-extrabold leading-none tabular-nums transition-opacity hover:opacity-80",
              isProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
            )}
          >
            {formatMoney(total.profit)}
          </button>
          <div className="mt-auto">
            <div className="flex items-center justify-between gap-1.5">
              {total.wins > 0 && (
                <button
                  type="button"
                  title="View winning trades"
                  onClick={() => onOpen("wins")}
                  className="text-[10.5px] font-semibold text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400"
                >
                  {total.wins}w <b className="font-bold tabular-nums">{formatSigned(total.wonAmount, 0)}</b>
                </button>
              )}
              {total.losses > 0 && (
                <button
                  type="button"
                  title="View losing trades"
                  onClick={() => onOpen("losses")}
                  className="text-[10.5px] font-semibold text-red-600 transition-opacity hover:opacity-80 dark:text-red-400"
                >
                  {total.losses}l <b className="font-bold tabular-nums">{formatSigned(total.lostAmount, 0)}</b>
                </button>
              )}
            </div>
            <span
              aria-hidden="true"
              className={cn("mt-1.5 block h-px w-full", isProfit ? "bg-emerald-500/40" : "bg-red-500/40")}
            />
            <div className="mt-1">
              <TrendSparkline trend={trend} isProfit={isProfit} />
            </div>
          </div>
        </>
      ) : (
        <span className="m-auto text-sm font-medium text-muted-foreground/50">&mdash;</span>
      )}
    </div>
  );
}

export function PerformanceCalendar({
  accountId,
  symbols,
  direction,
  advancedQuery,
  initialMonth,
}: PerformanceCalendarProps) {
  const { openPanel } = useTradePanel();
  const baseMonth = useMemo(() => startOfMonth(initialMonth ?? new Date()), [initialMonth]);
  const [monthOffset, setMonthOffset] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState<number | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const viewMonth = useMemo(() => addMonths(baseMonth, monthOffset), [baseMonth, monthOffset]);
  const { daily, loading: calendarLoading } = useCalendarMonthReturns(
    accountId,
    viewMonth,
    symbols,
    direction,
    advancedQuery
  );

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen]);

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
    const wonAmount = monthData.reduce((total, day) => total + day.winning, 0);
    const lostAmount = monthData.reduce((total, day) => total + day.losing, 0);
    const decided = winningTrades + losingTrades;
    const winRate = decided > 0 ? (winningTrades / decided) * 100 : 0;
    return { trades, profit, winningTrades, losingTrades, wonAmount, lostAmount, winRate };
  }, [monthData]);

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
        let wonAmount = 0;
        let lostAmount = 0;

        for (const day of weekDays) {
          const row = byDate.get(format(day, "yyyy-MM-dd"));
          if (!row) continue;
          profit += row.profit;
          trades += row.tradeCount;
          wins += row.winningTrades ?? 0;
          losses += row.losingTrades ?? 0;
          wonAmount += row.winning;
          lostAmount += row.losing;
        }

        return { profit, trades, wins, losses, wonAmount, lostAmount };
      }),
    [byDate, weeks]
  );

  const daysInMonth = endOfMonth(viewMonth).getDate();
  const curvePoints = useMemo(() => {
    const points: CurvePoint[] = [];
    let balance = 0;

    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i);
      const key = format(date, "yyyy-MM-dd");
      const day = byDate.get(key);
      if (day) balance += day.profit;
      points.push({ date: key, balance, hasData: Boolean(day), day });
    }

    return points;
  }, [byDate, daysInMonth, viewMonth]);

  const monthTradesQuery = useMemo<TradeQuery | null>(() => {
    const query: TradeQuery = {
      accountId,
      from: startOfDay(startOfMonth(viewMonth)),
      to: endOfDay(endOfMonth(viewMonth)),
    };
    if (symbols.length > 0) query.symbols = symbols;
    if (direction !== "Both") query.direction = direction;
    if (advancedQuery) {
      if (advancedQuery.ratingValues?.length) query.ratingValues = advancedQuery.ratingValues;
      if (advancedQuery.mindsets?.length) query.mindsets = advancedQuery.mindsets;
      if (advancedQuery.tagIds?.length) query.tagIds = advancedQuery.tagIds;
    }
    return query;
  }, [accountId, symbols, direction, advancedQuery, viewMonth]);

  const { trades: monthTrades } = useTradesByQuery(monthTradesQuery);

  const dayTrends = useMemo(() => {
    const map = new Map<string, number[]>();
    const closed = monthTrades
      .filter((trade) => trade.closeTime)
      .slice()
      .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime());

    for (const trade of closed) {
      const net = trade.netProfit ?? trade.grossProfit ?? 0;
      const key = format(trade.closeTime!, "yyyy-MM-dd");
      const trend = map.get(key) ?? [0];
      trend.push(parseFloat((trend[trend.length - 1] + net).toFixed(4)));
      map.set(key, trend);
    }

    return map;
  }, [monthTrades]);

  const weekTrends = useMemo(
    () =>
      weeks.map((weekDays) => {
        let trend = [0];

        for (const day of weekDays) {
          const dayTrend = dayTrends.get(format(day, "yyyy-MM-dd"));
          if (!dayTrend || dayTrend.length < 2) continue;
          const base = trend[trend.length - 1];
          trend = [...trend, ...dayTrend.slice(1).map((value) => parseFloat((base + value).toFixed(4)))];
        }

        return trend;
      }),
    [dayTrends, weeks]
  );

  const xTicks = useMemo(() => {
    if (curvePoints.length === 0) return undefined;
    const first = curvePoints[0].date;
    const middle = curvePoints[Math.floor(curvePoints.length / 2)].date;
    const last = curvePoints[curvePoints.length - 1].date;
    return [first, middle, last];
  }, [curvePoints]);

  const buildQuery = (from: Date, to: Date, filter: Filter): TradeQuery => {
    const query: TradeQuery = { accountId, from, to };
    if (symbols.length > 0) query.symbols = symbols;
    if (direction !== "Both") query.direction = direction;
    if (advancedQuery) {
      if (advancedQuery.ratingValues?.length) query.ratingValues = advancedQuery.ratingValues;
      if (advancedQuery.mindsets?.length) query.mindsets = advancedQuery.mindsets;
      if (advancedQuery.tagIds?.length) query.tagIds = advancedQuery.tagIds;
    }
    if (filter === "wins") query.winsOnly = true;
    if (filter === "losses") query.lossesOnly = true;
    return query;
  };

  const openDayTrades = (date: Date, filter: Filter) => {
    const dayLabel = format(date, "MMM d, yyyy");
    const title =
      filter === "wins"
        ? `Winning trades on ${dayLabel}`
        : filter === "losses"
          ? `Losing trades on ${dayLabel}`
          : `Trades on ${dayLabel}`;
    openPanel({ title, query: buildQuery(startOfDay(date), endOfDay(date), filter) });
  };

  const openWeekTrades = (weekStart: Date, weekEnd: Date, filter: Filter) => {
    const range = `${format(weekStart, "MMM d")} – ${format(weekEnd, "MMM d, yyyy")}`;
    const title =
      filter === "wins"
        ? `Winning trades ${range}`
        : filter === "losses"
          ? `Losing trades ${range}`
          : `Trades ${range}`;
    openPanel({ title, query: buildQuery(startOfDay(weekStart), endOfDay(weekEnd), filter) });
  };

  const openMonthTrades = (filter: Filter) => {
    const monthLabel = format(viewMonth, "MMMM yyyy");
    const title =
      filter === "wins"
        ? `Winning trades in ${monthLabel}`
        : filter === "losses"
          ? `Losing trades in ${monthLabel}`
          : `Trades in ${monthLabel}`;
    openPanel({
      title,
      query: buildQuery(startOfDay(startOfMonth(viewMonth)), endOfDay(endOfMonth(viewMonth)), filter),
    });
  };

  const handleCurveOpen = (dateKey: string, filter: Filter) => {
    openDayTrades(new Date(`${dateKey}T00:00:00`), filter);
  };

  const handlePrev = () => {
    setPickerOpen(false);
    setMonthOffset((month) => month - 1);
  };

  const handleNext = () => {
    setPickerOpen(false);
    setMonthOffset((month) => month + 1);
  };

  const handleTogglePicker = () => {
    if (pickerOpen) {
      setPickerOpen(false);
    } else {
      setPickerYear(viewMonth.getFullYear());
      setPickerOpen(true);
    }
  };

  const handlePickMonth = (monthIndex: number) => {
    const year = pickerYear ?? viewMonth.getFullYear();
    setMonthOffset((year - baseMonth.getFullYear()) * 12 + (monthIndex - baseMonth.getMonth()));
    setPickerOpen(false);
  };

  const isMonthProfit = monthSummary.profit >= 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="bg-gradient-to-b from-muted/10 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4 px-4 pb-2 pt-5 sm:px-5">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary">Performance</div>
            <div className="mt-1 flex items-baseline gap-3">
              <button
                type="button"
                title="View all month trades"
                onClick={() => openMonthTrades("all")}
                className={cn(
                  "text-3xl font-extrabold leading-none tracking-tight tabular-nums transition-opacity hover:opacity-80",
                  isMonthProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                )}
              >
                {calendarLoading ? "…" : formatMoney(monthSummary.profit, 0)}
              </button>
              <button
                type="button"
                title="View all month trades"
                onClick={() => openMonthTrades("all")}
                className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <b className="font-bold tabular-nums text-foreground">{calendarLoading ? "…" : monthSummary.trades}</b>{" "}
                trades
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <button
                type="button"
                title="View winning trades"
                onClick={() => openMonthTrades("wins")}
                className="font-bold text-emerald-600 transition-opacity hover:opacity-80 dark:text-emerald-400"
              >
                {calendarLoading ? "…" : `${monthSummary.winningTrades}W ${formatSigned(monthSummary.wonAmount, 0)}`}
              </button>
              <span aria-hidden="true">&middot;</span>
              <button
                type="button"
                title="View losing trades"
                onClick={() => openMonthTrades("losses")}
                className="font-bold text-red-600 transition-opacity hover:opacity-80 dark:text-red-400"
              >
                {calendarLoading ? "…" : `${monthSummary.losingTrades}L ${formatSigned(monthSummary.lostAmount, 0)}`}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <WinRateDonut winRate={calendarLoading ? 0 : monthSummary.winRate} />
            <div ref={pickerRef} className="relative flex items-center gap-1.5">
              <button
                type="button"
                onClick={handlePrev}
                aria-label="Previous month"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleTogglePicker}
                className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2.5 text-xs font-bold tabular-nums text-foreground transition-colors hover:border-ring hover:bg-accent"
              >
                {format(viewMonth, "MMM yyyy")}
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={handleNext}
                aria-label="Next month"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition-colors hover:border-ring hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              {pickerOpen && (
                <div className="absolute right-0 top-9 z-30 w-56 rounded-2xl border border-border bg-popover p-3 shadow-2xl">
                  <div className="mb-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setPickerYear((year) => (year ?? viewMonth.getFullYear()) - 1)}
                      aria-label="Previous year"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-sm font-extrabold tabular-nums text-foreground">
                      {pickerYear ?? viewMonth.getFullYear()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickerYear((year) => (year ?? viewMonth.getFullYear()) + 1)}
                      aria-label="Next year"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MONTH_NAMES.map((month, index) => {
                      const year = pickerYear ?? viewMonth.getFullYear();
                      const active = index === viewMonth.getMonth() && year === viewMonth.getFullYear();
                      return (
                        <button
                          key={month}
                          type="button"
                          onClick={() => handlePickMonth(index)}
                          className={cn(
                            "rounded-lg py-1.5 text-center text-[11.5px] font-semibold text-foreground transition-colors hover:bg-primary/10",
                            active && "bg-primary text-primary-foreground hover:bg-primary"
                          )}
                        >
                          {month}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 pb-1 sm:px-5">
          <div className={cn(isMonthProfit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
            <div className="h-[110px] sm:h-[130px]">
              <ResponsiveContainer width="100%" height="100%" minHeight={0}>
                <AreaChart data={curvePoints} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="calCurveFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    ticks={xTicks}
                    tickFormatter={(value: string) => format(new Date(`${value}T00:00:00`), "MMM d")}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                  />
                  <ReferenceLine y={0} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
                  <Tooltip
                    cursor={{ stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" }}
                    content={<BalanceTooltip onOpen={handleCurveOpen} />}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    fill="url(#calCurveFill)"
                    activeDot={{ r: 4, fill: "currentColor", stroke: "var(--card)", strokeWidth: 1.5 }}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1.5 pb-2 text-[10px] text-muted-foreground">
              Balance progress through the month &middot; hover a point for that day&rsquo;s trades
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="min-w-[820px]">
            <div className="grid grid-cols-[repeat(8,minmax(86px,1fr))] items-stretch gap-2 sm:gap-3">
              {WEEKDAY_LABELS.map((label) => (
                <div
                  key={label}
                  className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {label}
                </div>
              ))}
              <div className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-wider text-foreground/70">
                Week
              </div>

              {weeks.map((weekDays, weekIndex) => {
                const weekTotal = weekTotals[weekIndex];
                const hasWeekTrades = weekTotal.trades > 0;

                return (
                  <Fragment key={weekIndex}>
                    {weekDays.map((day) => {
                      const key = format(day, "yyyy-MM-dd");
                      return (
                        <DayCell
                          key={key}
                          date={day}
                          data={byDate.get(key)}
                          trend={dayTrends.get(key)}
                          inMonth={isSameMonth(day, viewMonth)}
                          today={isToday(day)}
                          weekend={isWeekend(day)}
                          onOpen={(filter) => openDayTrades(day, filter)}
                        />
                      );
                    })}
                    <WeekCell
                      weekIndex={weekIndex}
                      total={weekTotal}
                      trend={weekTrends[weekIndex]}
                      hasTrades={hasWeekTrades}
                      onOpen={(filter) => openWeekTrades(weekDays[0], weekDays[6], filter)}
                    />
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}