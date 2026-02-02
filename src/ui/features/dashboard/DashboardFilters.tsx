"use client";

import { Direction } from "@domain/enums";
import { format, subMonths, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Calendar, ChevronDown, Filter } from "lucide-react";
import { useState, useRef, useEffect } from "react";

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

const PRESETS = [
  { label: "Last 7 days", getRange: () => ({ from: subDays(new Date(), 7), to: new Date() }) },
  { label: "Last 30 days", getRange: () => ({ from: subDays(new Date(), 30), to: new Date() }) },
  { label: "Last 3 months", getRange: () => ({ from: subMonths(new Date(), 3), to: new Date() }) },
  { label: "This month", getRange: () => ({ from: startOfMonth(new Date()), to: new Date() }) },
  { label: "Last month", getRange: () => ({ from: startOfMonth(subMonths(new Date(), 1)), to: endOfMonth(subMonths(new Date(), 1)) }) },
];

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
    onChange({ ...filters, symbols: [] });
  };

  const clearSymbols = () => {
    onChange({ ...filters, symbols: [] });
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Filter className="w-4 h-4" />
        <span>Filters</span>
      </div>

      <div className="relative" ref={presetRef}>
        <button
          onClick={() => setPresetOpen((p) => !p)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-card text-sm hover:bg-accent"
        >
          <Calendar className="w-4 h-4" />
          {format(filters.from, "MMM d")} – {format(filters.to, "MMM d")}
          <ChevronDown className="w-4 h-4" />
        </button>
        {presetOpen && (
          <div className="absolute left-0 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-lg z-10">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onClick={() => {
                  const { from, to } = p.getRange();
                  onChange({ ...filters, from, to });
                  setPresetOpen(false);
                }}
                className="w-full text-left px-3 py-2 rounded-md text-sm hover:bg-accent"
              >
                {p.label}
              </button>
            ))}
          </div>
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
