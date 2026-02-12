"use client";

import {
  addMonths,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from "date-fns";
import { useMemo, useState } from "react";

export interface DateRangePopoverProps {
  from: Date;
  to: Date;
  onClose: () => void;
  onApply: (from: Date, to: Date) => void;
}

export function DateRangePopover({ from, to, onClose, onApply }: DateRangePopoverProps) {
  const [tempFrom, setTempFrom] = useState<Date>(from);
  const [tempTo, setTempTo] = useState<Date>(to);
  const [isSelectingEnd, setIsSelectingEnd] = useState(false);
  const [monthLeft, setMonthLeft] = useState<Date>(startOfMonth(from));
  const monthRight = useMemo(() => addMonths(monthLeft, 1), [monthLeft]);
  const today = useMemo(() => new Date(), []);

  const selectDay = (day: Date) => {
    if (!isSelectingEnd) {
      setTempFrom(day);
      setTempTo(day);
      setIsSelectingEnd(true);
      return;
    }

    if (day < tempFrom) {
      setTempFrom(day);
      setTempTo(tempFrom);
    } else {
      setTempTo(day);
    }
    setIsSelectingEnd(false);
  };

  const buildMonthDays = (month: Date) => {
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    const days: Date[] = [];
    for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
      days.push(d);
    }
    return days;
  };

  const isInRange = (day: Date) =>
    day.getTime() >= new Date(tempFrom).setHours(0, 0, 0, 0) &&
    day.getTime() <= new Date(tempTo).setHours(23, 59, 59, 999);

  const headerLabel = `${format(tempFrom, "MMM d, yyyy")} - ${format(tempTo, "MMM d, yyyy")}`;

  return (
    <div className="fixed inset-x-2 bottom-2 top-16 z-30 overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[540px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[80vh] sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => {
            const now = new Date();
            setTempFrom(now);
            setTempTo(now);
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Today
        </button>
        <button
          onClick={() => {
            const yesterday = subDays(new Date(), 1);
            setTempFrom(yesterday);
            setTempTo(yesterday);
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Yesterday
        </button>
        <button
          onClick={() => {
            const now = new Date();
            setTempFrom(startOfWeek(now));
            setTempTo(endOfWeek(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Week
        </button>
        <button
          onClick={() => {
            const now = subWeeks(new Date(), 1);
            setTempFrom(startOfWeek(now));
            setTempTo(endOfWeek(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Week
        </button>
        <button
          onClick={() => {
            const now = new Date();
            setTempFrom(startOfMonth(now));
            setTempTo(endOfMonth(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Month
        </button>
        <button
          onClick={() => {
            const now = subMonths(new Date(), 1);
            setTempFrom(startOfMonth(now));
            setTempTo(endOfMonth(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Month
        </button>
        <button
          onClick={() => {
            const now = new Date();
            setTempFrom(startOfYear(now));
            setTempTo(endOfYear(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Year
        </button>
        <button
          onClick={() => {
            const now = subYears(new Date(), 1);
            setTempFrom(startOfYear(now));
            setTempTo(endOfYear(now));
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Year
        </button>
        <button
          onClick={() => {
            setTempFrom(new Date(2010, 0, 1));
            setTempTo(new Date());
            setIsSelectingEnd(false);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          All Time
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 text-xs sm:grid-cols-2">
        {[monthLeft, monthRight].map((month, idx) => {
          const days = buildMonthDays(month);
          const monthLabel = format(month, "MMMM yyyy");
          const firstWeekday = new Date(month).getDay();
          return (
            <div key={idx}>
              <div className="mb-2 flex items-center justify-between">
                <button
                  disabled={idx === 0}
                  onClick={() => setMonthLeft((prev) => addMonths(prev, -1))}
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  &lt;
                </button>
                <span className="text-xs font-medium text-foreground">{monthLabel}</span>
                <button
                  disabled={idx === 1}
                  onClick={() => setMonthLeft((prev) => addMonths(prev, 1))}
                  className="px-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
                >
                  &gt;
                </button>
              </div>
              <div className="mb-1 grid grid-cols-7 gap-1 text-[10px] text-muted-foreground">
                <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {days.map((day) => {
                  const selected = isSameDay(day, tempFrom) || isSameDay(day, tempTo);
                  const inRange = isInRange(day);
                  const isToday = isSameDay(day, today);

                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => selectDay(day)}
                      className={[
                        "h-8 w-8 rounded-full text-xs transition-colors",
                        selected
                          ? "bg-primary font-semibold text-primary-foreground"
                          : inRange
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/60",
                        isToday ? "ring-1 ring-primary/70 ring-offset-1 ring-offset-popover" : "",
                      ].filter(Boolean).join(" ")}
                    >
                      {day.getDate()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={() => onApply(tempFrom, tempTo)}
          className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
