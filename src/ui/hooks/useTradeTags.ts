"use client";

import { useState, useEffect, useCallback } from "react";
import type { Tag } from "@domain/entities";
import type { Mindset, TagCategory } from "@domain/enums";
import { DexieTagRepository } from "@infrastructure/db/dexie";
import { DexieTradeRepository } from "@infrastructure/db/dexie";

const tagRepo = new DexieTagRepository();
const tradeRepo = new DexieTradeRepository();

export function useTradeTags(tradeId: number | undefined) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [tradeTags, setTradeTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (!tradeId) return;

    setIsLoading(true);
    setError(null);

    try {
      const [tags, forTrade] = await Promise.all([
        tagRepo.list(),
        tagRepo.listForTrade(tradeId),
      ]);
      setAllTags(tags);
      setTradeTags(forTrade);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load tags"));
      setAllTags([]);
      setTradeTags([]);
    } finally {
      setIsLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const replaceTags = useCallback(
    async (tagIds: number[]) => {
      if (!tradeId) return;

      try {
        await tagRepo.replaceForTrade(tradeId, tagIds);
        const forTrade = await tagRepo.listForTrade(tradeId);
        setTradeTags(forTrade);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to save tags"));
      }
    },
    [tradeId]
  );

  const updateRating = useCallback(
    async (rating: number) => {
      if (!tradeId) return;

      try {
        await tradeRepo.update(tradeId, { rating });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to save rating"));
      }
    },
    [tradeId]
  );

  const updateMindset = useCallback(
    async (mindset: Mindset) => {
      if (!tradeId) return;

      try {
        await tradeRepo.update(tradeId, { mindset });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to save mindset"));
      }
    },
    [tradeId]
  );

  const tagsByCategory = allTags.reduce(
    (acc, tag) => {
      const cat = tag.category as TagCategory;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(tag);
      return acc;
    },
    {} as Record<TagCategory, Tag[]>
  );

  const tradeTagIds = new Set(tradeTags.map((t) => t.id).filter((id): id is number => id != null));

  return {
    allTags,
    tradeTags,
    tagsByCategory,
    tradeTagIds,
    isLoading,
    error,
    replaceTags,
    updateRating,
    updateMindset,
    refetch: load,
  };
}
