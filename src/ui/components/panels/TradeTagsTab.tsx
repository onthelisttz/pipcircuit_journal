"use client";

import { useCallback } from "react";
import { Star, Loader2 } from "lucide-react";
import { useTrade, useTradeTags } from "@ui/hooks";
import { TagCategory } from "@domain/enums";
import { Mindset } from "@domain/enums";

const MINDSET_OPTIONS: { value: Mindset; label: string; emoji: string }[] = [
  { value: Mindset.Happy, label: "Happy", emoji: "😊" },
  { value: Mindset.Sad, label: "Sad", emoji: "😢" },
  { value: Mindset.Anxious, label: "Anxious", emoji: "😰" },
  { value: Mindset.Excited, label: "Excited", emoji: "🤩" },
  { value: Mindset.Neutral, label: "Neutral", emoji: "😐" },
];

const CATEGORY_LABELS: Record<TagCategory, string> = {
  [TagCategory.Strategy]: "Strategy",
  [TagCategory.Mistakes]: "Mistakes",
  [TagCategory.Custom]: "Custom",
};

interface TradeTagsTabProps {
  tradeId: number;
}

export function TradeTagsTab({ tradeId }: TradeTagsTabProps) {
  const { trade, refetch: refetchTrade } = useTrade(tradeId);
  const {
    tagsByCategory,
    tradeTagIds,
    isLoading,
    error,
    replaceTags,
    updateRating,
    updateMindset,
    refetch,
  } = useTradeTags(tradeId);

  const toggleTag = useCallback(
    (tagId: number) => {
      const next = new Set(tradeTagIds);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      void replaceTags([...next]);
    },
    [tradeTagIds, replaceTags]
  );

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Rating */}
      <div>
        <span className="text-sm text-muted-foreground">Rating</span>
        <div className="mt-1 flex gap-1">
          {[1, 2, 3, 4, 5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                void updateRating(r).then(() => refetchTrade());
              }}
              className="rounded p-1 transition-colors hover:bg-muted"
              title={`${r} star${r > 1 ? "s" : ""}`}
            >
              <Star
                className={`h-6 w-6 ${
                  trade?.rating != null && trade.rating >= r
                    ? "fill-amber-400 text-amber-400"
                    : "text-muted-foreground"
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      {/* Mindset */}
      <div>
        <span className="text-sm text-muted-foreground">Mindset</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {MINDSET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                void updateMindset(opt.value).then(() => refetchTrade());
              }}
              className={`rounded-md border px-2 py-1 text-sm transition-colors ${
                trade?.mindset === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-muted"
              }`}
            >
              {opt.emoji} {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tags by category */}
      <div className="space-y-4">
        {([TagCategory.Strategy, TagCategory.Mistakes, TagCategory.Custom] as const).map(
          (cat) => {
            const tags = tagsByCategory[cat] ?? [];
            return (
              <div key={cat}>
                <span className="text-sm font-medium text-muted-foreground">
                  {CATEGORY_LABELS[cat]}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No tags in this category yet
                    </span>
                  ) : (
                    tags.map((tag) => {
                      const selected = tag.id != null && tradeTagIds.has(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => tag.id != null && toggleTag(tag.id)}
                          className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                            selected
                              ? "border-transparent bg-primary/20 text-primary"
                              : "border-border hover:bg-muted"
                          }`}
                          style={
                            selected && tag.color
                              ? { borderColor: tag.color, backgroundColor: `${tag.color}20`, color: tag.color }
                              : undefined
                          }
                        >
                          {tag.name}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            );
          }
        )}
      </div>
    </div>
  );
}
