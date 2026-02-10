"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Tag } from "@domain/entities";
import type { Mindset, TagCategory } from "@domain/enums";
import { createTagRepository, createTradeRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useTradeTags(tradeId: number | undefined) {
  const { user } = useAuth();
  const tagRepo = useMemo(() => createTagRepository(user?.id), [user?.id]);
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
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
  }, [tradeId, tagRepo]);

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
    [tradeId, tagRepo]
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
    [tradeId, tradeRepo]
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
    [tradeId, tradeRepo]
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
