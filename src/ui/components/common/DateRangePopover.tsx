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
  const [monthLeft, setMonthLeft] = useState<Date>(startOfMonth(from));
  const monthRight = useMemo(() => addMonths(monthLeft, 1), [monthLeft]);

  const selectDay = (day: Date) => {
    if (!tempFrom || (tempFrom && tempTo)) {
      setTempFrom(day);
      setTempTo(day);
      return;
    }
    if (day < tempFrom) {
      setTempFrom(day);
    } else {
      setTempTo(day);
    }
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
    tempFrom &&
    tempTo &&
    day.getTime() >= new Date(tempFrom).setHours(0, 0, 0, 0) &&
    day.getTime() <= new Date(tempTo).setHours(23, 59, 59, 999);

  const headerLabel = `${format(tempFrom, "MMM d, yyyy")} – ${format(tempTo, "MMM d, yyyy")}`;

  return (
    <div className="absolute right-0 mt-2 z-20 w-[540px] rounded-xl border border-border bg-popover p-4 shadow-2xl animate-in fade-in-0 zoom-in-95">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => {
            const today = new Date();
            setTempFrom(today);
            setTempTo(today);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Today
        </button>
        <button
          onClick={() => {
            const today = new Date();
            const from = startOfWeek(today);
            const to = endOfWeek(today);
            setTempFrom(from);
            setTempTo(to);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Week
        </button>
        <button
          onClick={() => {
            const today = new Date();
            const lastWeek = subWeeks(today, 1);
            const from = startOfWeek(lastWeek);
            const to = endOfWeek(lastWeek);
            setTempFrom(from);
            setTempTo(to);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Week
        </button>
        <button
          onClick={() => {
            const to = new Date();
            const from = startOfMonth(to);
            const end = endOfMonth(to);
            setTempFrom(from);
            setTempTo(end);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Month
        </button>
        <button
          onClick={() => {
            const today = new Date();
            const lastMonth = subMonths(today, 1);
            const from = startOfMonth(lastMonth);
            const end = endOfMonth(lastMonth);
            setTempFrom(from);
            setTempTo(end);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Month
        </button>
        <button
          onClick={() => {
            const to = new Date();
            const from = startOfYear(to);
            const end = endOfYear(to);
            setTempFrom(from);
            setTempTo(end);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Current Year
        </button>
        <button
          onClick={() => {
            const today = new Date();
            const lastYear = subYears(today, 1);
            const from = startOfYear(lastYear);
            const end = endOfYear(lastYear);
            setTempFrom(from);
            setTempTo(end);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          Previous Year
        </button>
        <button
          onClick={() => {
            const to = new Date();
            const from = new Date(2010, 0, 1);
            setTempFrom(from);
            setTempTo(to);
          }}
          className="rounded-full border border-border px-2.5 py-1 hover:bg-accent"
        >
          All Time
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 text-xs">
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
              <div className="grid grid-cols-7 gap-1 text-[10px] text-muted-foreground mb-1">
                <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {days.map((day) => {
                  const selected = isSameDay(day, tempFrom) || (tempTo && isSameDay(day, tempTo));
                  const inRange = isInRange(day);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => selectDay(day)}
                      className={[
                        "h-7 w-7 rounded-full text-xs",
                        inRange ? "bg-accent text-accent-foreground" : "",
                        selected ? "bg-primary text-primary-foreground font-semibold" : "hover:bg-accent/60",
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

      <div className="mt-4 flex justify-between items-center">
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
