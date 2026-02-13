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
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export interface DateRangePopoverProps {
  from: Date;
  to: Date;
  onClose: () => void;
  onApply: (from: Date, to: Date) => void;
  quickPresetStorageKey?: string;
}

type QuickPresetKey =
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

const QUICK_PRESETS: QuickPreset[] = [
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
    getRange: (now) => ({ from: new Date(2010, 0, 1), to: now }),
  },
];
const QUICK_PRESET_KEYS = new Set<QuickPresetKey>(QUICK_PRESETS.map((preset) => preset.key));

function isQuickPresetKey(value: string): value is QuickPresetKey {
  return QUICK_PRESET_KEYS.has(value as QuickPresetKey);
}

function readStoredQuickPreset(storageKey?: string): QuickPresetKey | null {
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

export function DateRangePopover({
  from,
  to,
  onClose,
  onApply,
  quickPresetStorageKey,
}: DateRangePopoverProps) {
  const [tempFrom, setTempFrom] = useState<Date>(from);
  const [tempTo, setTempTo] = useState<Date>(to);
  const [isSelectingEnd, setIsSelectingEnd] = useState(false);
  const [monthLeft, setMonthLeft] = useState<Date>(startOfMonth(from));
  const monthRight = useMemo(() => addMonths(monthLeft, 1), [monthLeft]);
  const today = useMemo(() => new Date(), []);
  const [selectedQuickPreset, setSelectedQuickPreset] = useState<QuickPresetKey | null>(() => {
    const detected = detectQuickPreset(from, to, new Date());
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

  return (
    <div className="fixed inset-x-2 bottom-2 top-16 z-30 overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95 sm:absolute sm:inset-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[540px] sm:max-w-[calc(100vw-2rem)] sm:max-h-[80vh] sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
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
              setTempFrom(range.from);
              setTempTo(range.to);
              setMonthLeft(startOfMonth(range.from));
              setIsSelectingEnd(false);
              setSelectedQuickPreset(preset.key);
            }}
            className={quickPresetButtonClass(preset.key)}
          >
            {preset.label}
          </button>
        ))}
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
