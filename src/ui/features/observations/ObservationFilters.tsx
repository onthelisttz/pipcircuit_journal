"use client";

import { format } from "date-fns";
import { Calendar, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { DateRangePopover } from "@ui/components/common";
import type { ObservationCategory, ObservationSource } from "@domain/entities";

export interface ObservationFiltersState {
  from: Date;
  to: Date;
  categoryId: number | null;
  source: ObservationSource | "all";
}

interface ObservationFiltersProps {
  filters: ObservationFiltersState;
  onChange: (filters: ObservationFiltersState) => void;
  categories: ObservationCategory[];
}

export function ObservationFilters({ filters, onChange, categories }: ObservationFiltersProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [datePopoverStyle, setDatePopoverStyle] = useState<CSSProperties | undefined>();
  const dateRef = useRef<HTMLDivElement>(null);
  const categoryRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        !dateRef.current?.contains(e.target as Node) &&
        !categoryRef.current?.contains(e.target as Node) &&
        !sourceRef.current?.contains(e.target as Node)
      ) {
        setDateOpen(false);
        setCategoryOpen(false);
        setSourceOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const updateDatePopoverPosition = useCallback(() => {
    if (!dateOpen || typeof window === "undefined") return;
    const trigger = dateRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const gutter = 8;
    const popoverWidth = Math.min(540, window.innerWidth - gutter * 2);
    const left = Math.min(
      Math.max(gutter, Math.round(rect.right - popoverWidth)),
      window.innerWidth - gutter - popoverWidth
    );

    setDatePopoverStyle({
      top: Math.round(rect.top),
      left,
      width: popoverWidth,
      height: Math.round(rect.height),
    });
  }, [dateOpen]);

  useEffect(() => {
    if (!dateOpen) return;

    updateDatePopoverPosition();

    const handleReposition = () => updateDatePopoverPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [dateOpen, updateDatePopoverPosition]);

  const rangeLabel = `${format(filters.from, "MMM d, yyyy")} - ${format(filters.to, "MMM d, yyyy")}`;
  const categoryLabel = filters.categoryId == null
    ? "All categories"
    : categories.find((c) => c.id === filters.categoryId)?.name ?? "All categories";
  const sourceLabel =
    filters.source === "all"
      ? "All sources"
      : filters.source === "chart"
        ? "Chart"
        : "Manual";

  return (
    <div className="relative z-30 flex flex-wrap items-center gap-3 overflow-visible">
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
          <div className="fixed z-[80] overflow-visible" style={datePopoverStyle}>
            <div className="relative h-full w-full">
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
            </div>
          </div>
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

      <div className="relative" ref={sourceRef}>
        <button
          type="button"
          onClick={() => setSourceOpen((p) => !p)}
          className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm hover:bg-accent"
        >
          {sourceLabel}
          <ChevronDown className="h-4 w-4" />
        </button>
        {sourceOpen && (
          <div className="absolute left-0 z-10 mt-1 w-40 rounded-lg border border-border bg-popover p-1 shadow-lg">
            {([
              { value: "all", label: "All sources" },
              { value: "chart", label: "Chart" },
              { value: "manual", label: "Manual" },
            ] as const).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange({ ...filters, source: option.value });
                  setSourceOpen(false);
                }}
                className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
