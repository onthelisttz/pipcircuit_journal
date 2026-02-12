"use client";

import { Direction } from "@domain/enums";
import { format } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateRangePopover } from "@ui/components/common";

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

export function DashboardFilters({
  filters,
  onChange,
  availableSymbols,
}: DashboardFiltersProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        !dateRef.current?.contains(e.target as Node) &&
        !symbolRef.current?.contains(e.target as Node) &&
        !directionRef.current?.contains(e.target as Node)
      ) {
        setDateOpen(false);
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

  const toggleSymbol = (symbol: string) => {
    if (filters.symbols.length === 0) {
      const next = availableSymbols.filter((x) => x !== symbol);
      onChange({ ...filters, symbols: next });
      return;
    }

    const next = filters.symbols.includes(symbol)
      ? filters.symbols.filter((x) => x !== symbol)
      : [...filters.symbols, symbol];
    onChange({ ...filters, symbols: next });
  };

  const selectAllSymbols = () => {
    onChange({ ...filters, symbols: [...availableSymbols] });
  };

  const clearSymbols = () => {
    onChange({ ...filters, symbols: [] });
  };

  const rangeLabel = useMemo(
    () => `${format(filters.from, "MMM d, yyyy")} - ${format(filters.to, "MMM d, yyyy")}`,
    [filters.from, filters.to]
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative" ref={dateRef}>
        <button
          type="button"
          onClick={() => setDateOpen((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        >
          <Calendar className="h-4 w-4" />
          <span>{rangeLabel}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
        {dateOpen && (
          <DateRangePopover
            from={filters.from}
            to={filters.to}
            onClose={() => setDateOpen(false)}
            onApply={(from, to) => {
              onChange({ ...filters, from, to });
              setDateOpen(false);
            }}
          />
        )}
      </div>

      <div className="relative" ref={symbolRef}>
        <button
          type="button"
          onClick={() => setSymbolOpen((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        >
          {selectedSymbolsLabel}
          <ChevronDown className="h-4 w-4" />
        </button>
        {symbolOpen && (
          <div className="absolute left-0 z-10 mt-1 max-h-60 w-48 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            <div className="flex gap-2 border-b border-border px-2 py-1">
              <button
                type="button"
                onClick={selectAllSymbols}
                className="text-xs text-primary hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={clearSymbols}
                className="text-xs text-muted-foreground hover:underline"
              >
                Clear
              </button>
            </div>
            {availableSymbols.map((symbol) => {
              const checked =
                filters.symbols.length === 0 || filters.symbols.includes(symbol);
              return (
                <label
                  key={symbol}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 hover:bg-accent"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSymbol(symbol)}
                    className="rounded"
                  />
                  <span className="text-sm">{symbol}</span>
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
          type="button"
          onClick={() => setDirectionOpen((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        >
          {filters.direction}
          <ChevronDown className="h-4 w-4" />
        </button>
        {directionOpen && (
          <div className="absolute left-0 z-10 mt-1 w-32 rounded-lg border border-border bg-popover p-1 shadow-lg">
            {(["Both", Direction.Buy, Direction.Sell] as const).map((direction) => (
              <button
                key={direction}
                type="button"
                onClick={() => {
                  onChange({ ...filters, direction });
                  setDirectionOpen(false);
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {direction}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

