"use client";

import { Direction } from "@domain/enums";
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
import { Calendar, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

export interface DashboardFiltersState {
  symbols: string[];
  direction: Direction | "Both";
  from: Date;
  to: Date;
}

interface DashboardFiltersProps {
  filters: DashboardFiltersState;
  onChange: (filters: DashboardFiltersState) => void;
  availableSymbols: string[];
}

// (PRESETS array is no longer used; presets are handled inside DateRangePopover)

export function DashboardFilters({
  filters,
  onChange,
  availableSymbols,
}: DashboardFiltersProps) {
  const [presetOpen, setPresetOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const presetRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        !presetRef.current?.contains(e.target as Node) &&
        !symbolRef.current?.contains(e.target as Node) &&
        !directionRef.current?.contains(e.target as Node)
      ) {
        setPresetOpen(false);
        setSymbolOpen(false);
        setDirectionOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const selectedSymbolsLabel =
    filters.symbols.length === 0
      ? "All symbols"
      : filters.symbols.length === availableSymbols.length
        ? "All symbols"
        : `${filters.symbols.length} selected`;

  const toggleSymbol = (s: string) => {
    if (filters.symbols.length === 0) {
      const next = availableSymbols.filter((x) => x !== s);
      onChange({ ...filters, symbols: next });
    } else {
      const next = filters.symbols.includes(s)
        ? filters.symbols.filter((x) => x !== s)
        : [...filters.symbols, s];
      onChange({ ...filters, symbols: next });
    }
  };

  const selectAllSymbols = () => {
    onChange({ ...filters, symbols: [...availableSymbols] });
  };

  const clearSymbols = () => {
    onChange({ ...filters, symbols: [] });
  };

  const rangeLabel = useMemo(
    () => `${format(filters.from, "MMM d, yyyy")} – ${format(filters.to, "MMM d, yyyy")}`,
    [filters.from, filters.to]
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative" ref={presetRef}>
        <button
          onClick={() => setPresetOpen((p) => !p)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm hover:bg-accent"
        >
          <Calendar className="w-4 h-4" />
          <span>{rangeLabel}</span>
          <ChevronDown className="w-4 h-4" />
        </button>
        {presetOpen && (
          <DateRangePopover
            from={filters.from}
            to={filters.to}
            onClose={() => setPresetOpen(false)}
            onApply={(from, to) => {
              onChange({ ...filters, from, to });
              setPresetOpen(false);
            }}
          />
        )}
      </div>

      <div className="relative" ref={symbolRef}>
        <button
          onClick={() => setSymbolOpen((p) => !p)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm hover:bg-accent"
        >
          {selectedSymbolsLabel}
          <ChevronDown className="w-4 h-4" />
        </button>
        {symbolOpen && (
          <div className="absolute left-0 mt-1 w-48 max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg z-10">
            <div className="flex gap-2 px-2 py-1 border-b border-border">
              <button
                onClick={selectAllSymbols}
                className="text-xs text-primary hover:underline"
              >
                All
              </button>
              <button
                onClick={clearSymbols}
                className="text-xs text-muted-foreground hover:underline"
              >
                Clear
              </button>
            </div>
            {availableSymbols.map((s) => {
              const checked =
                filters.symbols.length === 0 || filters.symbols.includes(s);
              return (
                <label
                  key={s}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-accent cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSymbol(s)}
                    className="rounded"
                  />
                  <span className="text-sm">{s}</span>
                </label>
              );
            })}
            {availableSymbols.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">No symbols</div>
            )}
          </div>
        )}
      </div>

      <div className="relative" ref={directionRef}>
        <button
          onClick={() => setDirectionOpen((p) => !p)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm hover:bg-accent"
        >
          {filters.direction}
          <ChevronDown className="w-4 h-4" />
        </button>
        {directionOpen && (
          <div className="absolute left-0 mt-1 w-32 rounded-lg border border-border bg-popover p-1 shadow-lg z-10">
            {(["Both", Direction.Buy, Direction.Sell] as const).map((d) => (
              <button
                key={d}
                onClick={() => {
                  onChange({ ...filters, direction: d });
                  setDirectionOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent"
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface DateRangePopoverProps {
  from: Date;
  to: Date;
  onClose: () => void;
  onApply: (from: Date, to: Date) => void;
}

function DateRangePopover({ from, to, onClose, onApply }: DateRangePopoverProps) {
  const [tempFrom, setTempFrom] = useState<Date>(from);
  const [tempTo, setTempTo] = useState<Date>(to);
  const [isSelectingEnd, setIsSelectingEnd] = useState(false);
  const [monthLeft, setMonthLeft] = useState<Date>(startOfMonth(from));
  const monthRight = useMemo(() => startOfMonth(addMonths(monthLeft, 1)), [monthLeft]);

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
    tempFrom &&
    tempTo &&
    day.getTime() >= new Date(tempFrom).setHours(0, 0, 0, 0) &&
    day.getTime() <= new Date(tempTo).setHours(23, 59, 59, 999);

  const headerLabel = `${format(tempFrom, "MMM d, yyyy")} – ${format(
    tempTo,
    "MMM d, yyyy"
  )}`;

  return (
    <div className="absolute right-0 mt-2 z-20 w-[540px] rounded-xl border border-border bg-popover p-4 shadow-2xl animate-in fade-in-0 zoom-in-95">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{headerLabel}</span>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={() => {
            const today = new Date();
            setTempFrom(today);
            setTempTo(today);
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
            setIsSelectingEnd(false);
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
          const firstWeekday = new Date(month).getDay(); // 0-6
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
                <span>S</span>
                <span>M</span>
                <span>T</span>
                <span>W</span>
                <span>T</span>
                <span>F</span>
                <span>S</span>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {days.map((day) => {
                  const selected =
                    isSameDay(day, tempFrom) || (tempTo && isSameDay(day, tempTo));
                  const inRange = isInRange(day);
                  return (
                    <button
                      key={day.toISOString()}
                      onClick={() => selectDay(day)}
                      className={[
                        "h-7 w-7 rounded-full text-xs",
                        inRange ? "bg-accent text-accent-foreground" : "",
                        selected
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "hover:bg-accent/60",
                      ]
                        .filter(Boolean)
                        .join(" ")}
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
