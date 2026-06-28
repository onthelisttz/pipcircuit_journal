"use client";

import {
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  isSameDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
  subYears,
} from "date-fns";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { APP_ALL_TIME_START_DATE, clampDateToAllTimeStart } from "@lib/date-range";

export interface DateRangePopoverProps {
  from: Date;
  to: Date;
  onClose: () => void;
  onApply: (from: Date, to: Date) => void;
  quickPresetStorageKey?: string;
  align?: "left" | "right";
  compact?: boolean;
}

export type QuickPresetKey =
  | "today"
  | "yesterday"
  | "currentWeek"
  | "previousWeek"
  | "currentMonth"
  | "previousMonth"
  | "currentYear"
  | "previousYear"
  | "allTime";

interface QuickPreset {
  key: QuickPresetKey;
  label: string;
  getRange: (now: Date) => { from: Date; to: Date };
}

export const QUICK_PRESETS: QuickPreset[] = [
  {
    key: "today",
    label: "Today",
    getRange: (now) => ({ from: now, to: now }),
  },
  {
    key: "yesterday",
    label: "Yesterday",
    getRange: (now) => {
      const yesterday = subDays(now, 1);
      return { from: yesterday, to: yesterday };
    },
  },
  {
    key: "currentWeek",
    label: "Current Week",
    getRange: (now) => ({ from: startOfWeek(now), to: endOfWeek(now) }),
  },
  {
    key: "previousWeek",
    label: "Previous Week",
    getRange: (now) => {
      const previousWeek = subWeeks(now, 1);
      return { from: startOfWeek(previousWeek), to: endOfWeek(previousWeek) };
    },
  },
  {
    key: "currentMonth",
    label: "Current Month",
    getRange: (now) => ({ from: startOfMonth(now), to: endOfMonth(now) }),
  },
  {
    key: "previousMonth",
    label: "Previous Month",
    getRange: (now) => {
      const previousMonth = subMonths(now, 1);
      return { from: startOfMonth(previousMonth), to: endOfMonth(previousMonth) };
    },
  },
  {
    key: "currentYear",
    label: "Current Year",
    getRange: (now) => ({ from: startOfYear(now), to: endOfYear(now) }),
  },
  {
    key: "previousYear",
    label: "Previous Year",
    getRange: (now) => {
      const previousYear = subYears(now, 1);
      return { from: startOfYear(previousYear), to: endOfYear(previousYear) };
    },
  },
  {
    key: "allTime",
    label: "All Time",
    getRange: (now) => ({ from: new Date(APP_ALL_TIME_START_DATE), to: now }),
  },
];
const QUICK_PRESET_KEYS = new Set<QuickPresetKey>(QUICK_PRESETS.map((preset) => preset.key));
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isQuickPresetKey(value: string): value is QuickPresetKey {
  return QUICK_PRESET_KEYS.has(value as QuickPresetKey);
}

export function readStoredQuickPreset(storageKey?: string): QuickPresetKey | null {
  if (!storageKey || typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  return isQuickPresetKey(raw) ? raw : null;
}

function writeStoredQuickPreset(storageKey: string | undefined, preset: QuickPresetKey | null): void {
  if (!storageKey || typeof window === "undefined") {
    return;
  }

  if (!preset) {
    window.localStorage.removeItem(storageKey);
    return;
  }

  window.localStorage.setItem(storageKey, preset);
}

function matchesDayRange(aFrom: Date, aTo: Date, bFrom: Date, bTo: Date): boolean {
  return isSameDay(aFrom, bFrom) && isSameDay(aTo, bTo);
}

function detectQuickPreset(from: Date, to: Date, now: Date): QuickPresetKey | null {
  for (const preset of QUICK_PRESETS) {
    const range = preset.getRange(now);
    if (matchesDayRange(from, to, range.from, range.to)) {
      return preset.key;
    }
  }
  return null;
}

export function recomputePresetDates(
  from: Date,
  to: Date,
  quickPresetStorageKey?: string
): { from: Date; to: Date } | null {
  const storedKey = readStoredQuickPreset(quickPresetStorageKey);
  if (storedKey) {
    const preset = QUICK_PRESETS.find((p) => p.key === storedKey);
    if (preset) {
      return preset.getRange(new Date());
    }
  }
  const detected = detectQuickPreset(from, to, new Date());
  if (detected) {
    const preset = QUICK_PRESETS.find((p) => p.key === detected);
    if (preset) {
      return preset.getRange(new Date());
    }
  }
  return null;
}

export function DateRangePopover({
  from,
  to,
  onClose,
  onApply,
  quickPresetStorageKey,
  align = "right",
  compact = false,
}: DateRangePopoverProps) {
  const today = useMemo(() => new Date(), []);
  const minSelectableDate = useMemo(() => startOfDay(APP_ALL_TIME_START_DATE), []);
  const maxSelectableDate = useMemo(() => endOfDay(today), [today]);
  const minMonth = useMemo(() => startOfMonth(APP_ALL_TIME_START_DATE), []);
  const maxLeftMonth = useMemo(() => {
    const candidate = startOfMonth(subMonths(today, 1));
    return candidate.getTime() < minMonth.getTime() ? minMonth : candidate;
  }, [minMonth, today]);
  const normalizeDate = useCallback(
    (date: Date): Date => {
      const clampedMin = clampDateToAllTimeStart(date);
      return clampedMin.getTime() > maxSelectableDate.getTime()
        ? new Date(maxSelectableDate)
        : clampedMin;
    },
    [maxSelectableDate]
  );
  const initialRange = useMemo(() => {
    const normalizedFrom = normalizeDate(from);
    const normalizedTo = normalizeDate(to);
    if (normalizedTo.getTime() < normalizedFrom.getTime()) {
      return { from: normalizedFrom, to: normalizedFrom };
    }
    return { from: normalizedFrom, to: normalizedTo };
  }, [from, to, normalizeDate]);
  const clampMonthLeft = (month: Date): Date => {
    const normalizedMonth = startOfMonth(month);
    if (normalizedMonth.getTime() < minMonth.getTime()) return minMonth;
    if (normalizedMonth.getTime() > maxLeftMonth.getTime()) return maxLeftMonth;
    return normalizedMonth;
  };

  const [tempFrom, setTempFrom] = useState<Date>(initialRange.from);
  const [tempTo, setTempTo] = useState<Date>(initialRange.to);
  const [isSelectingEnd, setIsSelectingEnd] = useState(false);
  const [monthLeft, setMonthLeft] = useState<Date>(clampMonthLeft(startOfMonth(initialRange.from)));
  const monthRight = useMemo(() => addMonths(monthLeft, 1), [monthLeft]);
  const [selectedQuickPreset, setSelectedQuickPreset] = useState<QuickPresetKey | null>(() => {
    const detected = detectQuickPreset(initialRange.from, initialRange.to, new Date());
    return detected ?? readStoredQuickPreset(quickPresetStorageKey);
  });

  useEffect(() => {
    writeStoredQuickPreset(quickPresetStorageKey, selectedQuickPreset);
  }, [quickPresetStorageKey, selectedQuickPreset]);

  const quickPresetButtonClass = (presetKey: QuickPresetKey) =>
    [
      "rounded-full border px-2.5 py-1 transition-colors",
      selectedQuickPreset === presetKey
        ? "border-primary bg-primary/15 font-medium text-primary"
        : "border-border hover:bg-accent",
    ].join(" ");

  const selectDay = (day: Date) => {
    const isDayDisabled =
      day.getTime() < minSelectableDate.getTime() || day.getTime() > maxSelectableDate.getTime();
    if (isDayDisabled) return;

    setSelectedQuickPreset(null);
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
  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = minMonth.getFullYear(); y <= maxLeftMonth.getFullYear(); y += 1) {
      years.push(y);
    }
    return years;
  }, [maxLeftMonth, minMonth]);
  const canGoPrevMonth = monthLeft.getTime() > minMonth.getTime();
  const canGoNextMonth = monthLeft.getTime() < maxLeftMonth.getTime();
  const setVisibleMonth = (monthIndex: number, year: number) => {
    setMonthLeft(clampMonthLeft(new Date(year, monthIndex, 1)));
  };
  const shiftVisibleMonth = (delta: number) => {
    setMonthLeft((prev) => clampMonthLeft(addMonths(prev, delta)));
  };
  const rootClassName = [
    "fixed inset-x-2 bottom-2 top-16 z-30 overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95",
    compact ? "sm:w-[300px] sm:p-3" : "sm:w-[540px] sm:p-4",
    align === "left" ? "sm:left-0 sm:right-auto" : "sm:right-0 sm:left-auto",
    "sm:absolute sm:inset-y-auto sm:top-full sm:mt-2 sm:max-w-[calc(100vw-2rem)] sm:max-h-[80vh]",
  ].join(" ");

  return (
    <div className={rootClassName}>
      <div className="mb-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {headerLabel}
        </span>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close date picker"
        >
          <X className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Close</span>
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {QUICK_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => {
              const now = new Date();
              const range = preset.getRange(now);
              const normalizedFrom = normalizeDate(range.from);
              const normalizedTo = normalizeDate(range.to);
              setTempFrom(normalizedFrom);
              setTempTo(normalizedTo.getTime() < normalizedFrom.getTime() ? normalizedFrom : normalizedTo);
              setMonthLeft(clampMonthLeft(startOfMonth(normalizedFrom)));
              setIsSelectingEnd(false);
              setSelectedQuickPreset(preset.key);
            }}
            className={quickPresetButtonClass(preset.key)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => shiftVisibleMonth(-1)}
          disabled={!canGoPrevMonth}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-2">
          <select
            value={monthLeft.getMonth()}
            onChange={(event) => setVisibleMonth(Number(event.target.value), monthLeft.getFullYear())}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            aria-label="Select month"
          >
            {MONTH_NAMES.map((monthName, monthIndex) => (
              <option key={monthName} value={monthIndex}>
                {monthName}
              </option>
            ))}
          </select>
          <select
            value={monthLeft.getFullYear()}
            onChange={(event) => setVisibleMonth(monthLeft.getMonth(), Number(event.target.value))}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            aria-label="Select year"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => shiftVisibleMonth(1)}
          disabled={!canGoNextMonth}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className={`grid grid-cols-1 gap-4 text-xs ${compact ? "" : "sm:grid-cols-2"}`}>
        {(compact ? [monthLeft] : [monthLeft, monthRight]).map((month, idx) => {
          const days = buildMonthDays(month);
          const monthLabel = format(month, "MMMM yyyy");
          const firstWeekday = new Date(month).getDay();
          return (
            <div key={idx}>
              <div className="mb-2 flex items-center justify-center">
                <span className="text-xs font-medium text-foreground">{monthLabel}</span>
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
                  const isDisabled =
                    day.getTime() < minSelectableDate.getTime() ||
                    day.getTime() > maxSelectableDate.getTime();

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      disabled={isDisabled}
                      onClick={() => selectDay(day)}
                      className={[
                        "h-8 w-8 rounded-full text-xs transition-colors",
                        selected
                          ? "bg-primary font-semibold text-primary-foreground"
                          : inRange
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/60",
                        isDisabled ? "cursor-not-allowed opacity-35 hover:bg-transparent" : "",
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
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onApply(normalizeDate(tempFrom), normalizeDate(tempTo))}
          className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
