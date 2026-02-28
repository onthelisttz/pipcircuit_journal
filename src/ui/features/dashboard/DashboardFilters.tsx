"use client";

import { Direction, Mindset, TagCategory } from "@domain/enums";
import type { Tag } from "@domain/entities";
import { format } from "date-fns";
import { Calendar, ChevronDown, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateRangePopover } from "@ui/components/common";

export const DASHBOARD_RATING_OPTIONS = [1, 2, 3, 4, 5] as const;
export const DASHBOARD_MINDSET_OPTIONS: Array<{
  value: Mindset;
  label: string;
  emoji: string;
}> = [
  { value: Mindset.Happy, label: "Happy", emoji: "😊" },
  { value: Mindset.Sad, label: "Sad", emoji: "😢" },
  { value: Mindset.Anxious, label: "Anxious", emoji: "😰" },
  { value: Mindset.Excited, label: "Excited", emoji: "🤩" },
  { value: Mindset.Neutral, label: "Neutral", emoji: "😐" },
];

export interface DashboardFiltersState {
  symbols: string[];
  direction: Direction | "Both";
  from: Date;
  to: Date;
  ratings: number[];
  mindsets: Mindset[];
  strategyTagIds: number[];
  rulesTagIds: number[];
  customTagIds: number[];
}

interface DashboardFiltersProps {
  filters: DashboardFiltersState;
  onChange: (filters: DashboardFiltersState) => void;
  availableSymbols: string[];
  availableTags: Tag[];
}

function countLabel(selectedCount: number, totalCount: number, allLabel: string) {
  if (totalCount === 0) return allLabel;
  if (selectedCount === 0 || selectedCount === totalCount) return allLabel;
  return `${selectedCount} selected`;
}

function toggleInList<T>(current: T[], value: T): T[] {
  return current.includes(value)
    ? current.filter((entry) => entry !== value)
    : [...current, value];
}

function getTagIds(tags: Tag[]): number[] {
  return tags.map((tag) => tag.id).filter((id): id is number => id != null);
}

function getEffectiveSelectedCount(selectedCount: number, totalCount: number): number {
  if (totalCount <= 0) return 0;
  if (selectedCount === 0 || selectedCount === totalCount) return 0;
  return selectedCount;
}

export function DashboardFilters({
  filters,
  onChange,
  availableSymbols,
  availableTags,
}: DashboardFiltersProps) {
  const [dateOpen, setDateOpen] = useState(false);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [directionOpen, setDirectionOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);

  const dateRef = useRef<HTMLDivElement>(null);
  const symbolRef = useRef<HTMLDivElement>(null);
  const directionRef = useRef<HTMLDivElement>(null);
  const tagsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !dateRef.current?.contains(target) &&
        !symbolRef.current?.contains(target) &&
        !directionRef.current?.contains(target) &&
        !tagsRef.current?.contains(target)
      ) {
        setDateOpen(false);
        setSymbolOpen(false);
        setDirectionOpen(false);
        setTagsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const strategyTags = useMemo(
    () =>
      availableTags
        .filter((tag) => tag.category === TagCategory.Strategy && tag.id != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableTags]
  );
  const rulesTags = useMemo(
    () =>
      availableTags
        .filter((tag) => tag.category === TagCategory.Rules && tag.id != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableTags]
  );
  const customTags = useMemo(
    () =>
      availableTags
        .filter((tag) => tag.category === TagCategory.Custom && tag.id != null)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [availableTags]
  );

  const selectedSymbolsLabel = countLabel(
    filters.symbols.length,
    availableSymbols.length,
    "All symbols"
  );

  const activeTagFilterCount = useMemo(() => {
    const ratingCount = getEffectiveSelectedCount(
      filters.ratings.length,
      DASHBOARD_RATING_OPTIONS.length
    );
    const mindsetCount = getEffectiveSelectedCount(
      filters.mindsets.length,
      DASHBOARD_MINDSET_OPTIONS.length
    );
    const strategyCount = getEffectiveSelectedCount(
      filters.strategyTagIds.length,
      strategyTags.length
    );
    const rulesCount = getEffectiveSelectedCount(filters.rulesTagIds.length, rulesTags.length);
    const customCount = getEffectiveSelectedCount(
      filters.customTagIds.length,
      customTags.length
    );
    return ratingCount + mindsetCount + strategyCount + rulesCount + customCount;
  }, [
    filters.ratings.length,
    filters.mindsets.length,
    filters.strategyTagIds.length,
    filters.rulesTagIds.length,
    filters.customTagIds.length,
    strategyTags.length,
    rulesTags.length,
    customTags.length,
  ]);

  const rangeLabel = useMemo(
    () => `${format(filters.from, "MMM d, yyyy")} - ${format(filters.to, "MMM d, yyyy")}`,
    [filters.from, filters.to]
  );

  const applyTagFilters = (updates: Partial<DashboardFiltersState>) => {
    onChange({ ...filters, ...updates });
  };

  const resetAllTagFilters = () => {
    applyTagFilters({
      ratings: [],
      mindsets: [],
      strategyTagIds: [],
      rulesTagIds: [],
      customTagIds: [],
    });
  };

  const selectAllTagFilters = () => {
    applyTagFilters({
      ratings: [...DASHBOARD_RATING_OPTIONS],
      mindsets: DASHBOARD_MINDSET_OPTIONS.map((option) => option.value),
      strategyTagIds: getTagIds(strategyTags),
      rulesTagIds: getTagIds(rulesTags),
      customTagIds: getTagIds(customTags),
    });
  };

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
            quickPresetStorageKey="dashboard-date-quick-preset"
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
          <div className="absolute left-0 z-10 mt-1 max-h-60 w-52 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
            <div className="flex gap-2 border-b border-border px-2 py-1">
              <button
                type="button"
                onClick={() => onChange({ ...filters, symbols: [...availableSymbols] })}
                className="text-xs text-primary hover:underline"
              >
                All
              </button>
              <button
                type="button"
                onClick={() => onChange({ ...filters, symbols: [] })}
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
                    onChange={() =>
                      onChange({
                        ...filters,
                        symbols: toggleInList(filters.symbols, symbol),
                      })
                    }
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

      <div className="relative" ref={tagsRef}>
        <button
          type="button"
          onClick={() => setTagsOpen((p) => !p)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:bg-accent ${
            activeTagFilterCount > 0
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-border bg-card"
          }`}
        >
          {activeTagFilterCount > 0 ? `Tags (${activeTagFilterCount})` : "Tags"}
          <ChevronDown className="h-4 w-4" />
        </button>
        {tagsOpen && (
          <div className="absolute right-0 z-10 mt-1 max-h-[70vh] w-[22rem] overflow-y-auto rounded-lg border border-border bg-popover p-3 shadow-lg">
            <div className="mb-3 flex items-center justify-between border-b border-border pb-2">
              <span className="text-sm font-semibold">Tag Filters</span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  onClick={selectAllTagFilters}
                  className="text-primary hover:underline"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={resetAllTagFilters}
                  className="text-muted-foreground hover:underline"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Rating</span>
                  <button
                    type="button"
                    onClick={() => applyTagFilters({ ratings: [] })}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Any
                  </button>
                </div>
                <div className="flex items-center gap-1">
                  {DASHBOARD_RATING_OPTIONS.map((rating) => {
                    const selectedRating =
                      filters.ratings.length === 1
                        ? filters.ratings[0]
                        : filters.ratings.length > 1
                          ? Math.max(...filters.ratings)
                          : null;
                    const filled = selectedRating != null && selectedRating >= rating;

                    return (
                      <button
                        key={rating}
                        type="button"
                        onClick={() =>
                          applyTagFilters({
                            ratings: selectedRating === rating ? [] : [rating],
                          })
                        }
                        className="rounded p-1 transition-colors hover:bg-muted"
                        aria-label={`Set rating ${rating}`}
                        title={`${rating} star${rating > 1 ? "s" : ""}`}
                      >
                        <Star
                          className={`h-5 w-5 ${
                            filled
                              ? "fill-amber-400 text-amber-400"
                              : "text-muted-foreground"
                          }`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Mindset</span>
                  <button
                    type="button"
                    onClick={() => applyTagFilters({ mindsets: [] })}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Any
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {DASHBOARD_MINDSET_OPTIONS.map((mindset) => {
                    const selected =
                      filters.mindsets.length === 0 || filters.mindsets.includes(mindset.value);
                    return (
                      <button
                        key={mindset.value}
                        type="button"
                        onClick={() =>
                          applyTagFilters({
                            mindsets: toggleInList(filters.mindsets, mindset.value),
                          })
                        }
                        className={`rounded-md border px-2 py-1 text-sm transition-colors ${
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:bg-muted"
                        }`}
                      >
                        {mindset.emoji} {mindset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Strategy</span>
                  <button
                    type="button"
                    onClick={() => applyTagFilters({ strategyTagIds: [] })}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Any
                  </button>
                </div>
                {strategyTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No strategy tags</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {strategyTags.map((tag) => {
                      const tagId = tag.id!;
                      const selected =
                        filters.strategyTagIds.length === 0 ||
                        filters.strategyTagIds.includes(tagId);
                      return (
                        <button
                          key={tagId}
                          type="button"
                          onClick={() =>
                            applyTagFilters({
                              strategyTagIds: toggleInList(filters.strategyTagIds, tagId),
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          style={
                            selected && tag.color
                              ? {
                                  borderColor: tag.color,
                                  backgroundColor: `${tag.color}20`,
                                  color: tag.color,
                                }
                              : undefined
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Rules</span>
                  <button
                    type="button"
                    onClick={() => applyTagFilters({ rulesTagIds: [] })}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Any
                  </button>
                </div>
                {rulesTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No rules tags</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {rulesTags.map((tag) => {
                      const tagId = tag.id!;
                      const selected =
                        filters.rulesTagIds.length === 0 ||
                        filters.rulesTagIds.includes(tagId);
                      return (
                        <button
                          key={tagId}
                          type="button"
                          onClick={() =>
                            applyTagFilters({
                              rulesTagIds: toggleInList(filters.rulesTagIds, tagId),
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          style={
                            selected && tag.color
                              ? {
                                  borderColor: tag.color,
                                  backgroundColor: `${tag.color}20`,
                                  color: tag.color,
                                }
                              : undefined
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">Custom</span>
                  <button
                    type="button"
                    onClick={() => applyTagFilters({ customTagIds: [] })}
                    className="text-[11px] text-muted-foreground hover:underline"
                  >
                    Any
                  </button>
                </div>
                {customTags.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No custom tags</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {customTags.map((tag) => {
                      const tagId = tag.id!;
                      const selected =
                        filters.customTagIds.length === 0 ||
                        filters.customTagIds.includes(tagId);
                      return (
                        <button
                          key={tagId}
                          type="button"
                          onClick={() =>
                            applyTagFilters({
                              customTagIds: toggleInList(filters.customTagIds, tagId),
                            })
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            selected
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          style={
                            selected && tag.color
                              ? {
                                  borderColor: tag.color,
                                  backgroundColor: `${tag.color}20`,
                                  color: tag.color,
                                }
                              : undefined
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
