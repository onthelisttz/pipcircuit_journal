"use client";

import { format } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DateRangePopover } from "@ui/components/common";
import type { ObservationCategory } from "@domain/entities";

export interface ObservationFiltersState {
  from: Date;
  to: Date;
  categoryId: number | null;
}

interface ObservationFiltersProps {
  filters: ObservationFiltersState;
  onChange: (filters: ObservationFiltersState) => void;
  categories: ObservationCategory[];
}

export function ObservationFilters({ filters, onChange, categories }: ObservationFiltersProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!dateRef.current?.contains(e.target as Node) && !categoryRef.current?.contains(e.target as Node)) {
        setDateOpen(false);
        setCategoryOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const rangeLabel = `${format(filters.from, "MMM d, yyyy")} - ${format(filters.to, "MMM d, yyyy")}`;
  const categoryLabel = filters.categoryId == null
    ? "All categories"
    : categories.find((c) => c.id === filters.categoryId)?.name ?? "All categories";

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
            quickPresetStorageKey="observations-date-quick-preset"
            onClose={() => setDateOpen(false)}
            onApply={(from, to) => {
              onChange({ ...filters, from, to });
              setDateOpen(false);
            }}
          />
        )}
      </div>

      <div className="relative" ref={categoryRef}>
        <button
          type="button"
          onClick={() => setCategoryOpen((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        >
          {categoryLabel}
          <ChevronDown className="h-4 w-4" />
        </button>
        {categoryOpen && (
          <div className="absolute left-0 z-10 mt-1 w-48 rounded-lg border border-border bg-popover p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                onChange({ ...filters, categoryId: null });
                setCategoryOpen(false);
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
            >
              All categories
            </button>
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => {
                  onChange({ ...filters, categoryId: category.id ?? null });
                  setCategoryOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: category.color }}
                />
                {category.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
