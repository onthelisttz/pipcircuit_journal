"use client";

import { useState, useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Tag } from "@domain/entities";
import { TagCategory } from "@domain/enums";
import type { Mindset } from "@domain/enums";
import { createTagRepository, createTradeRepository } from "@infrastructure/db/createDualRepositories";
import { db } from "@infrastructure/db/dexie/database";
import { useAuth } from "@ui/hooks/useAuth";

const TAG_CATEGORIES = new Set<TagCategory>(Object.values(TagCategory));

function normalizeTag(tag: Tag): Tag {
  const name = typeof tag.name === "string" && tag.name.trim() ? tag.name.trim() : "Untitled";
  const category = TAG_CATEGORIES.has(tag.category as TagCategory)
    ? (tag.category as TagCategory)
    : TagCategory.Custom;
  const color = typeof tag.color === "string" && tag.color.trim() ? tag.color : "#6b7280";
  return { ...tag, name, category, color };
}

export function useTradeTags(tradeId: number | undefined) {
  const { user } = useAuth();
  const tagRepo = useMemo(() => createTagRepository(user?.id), [user?.id]);
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
  const liveAllTags = useLiveQuery(
    () => db.tags.filter((tag) => !tag.deletedAt).toArray(),
    [user?.id]
  );
  const liveTradeTags = useLiveQuery(
    async () => {
      if (!tradeId) return [];
      const links = await db.trade_tags
        .where("tradeId")
        .equals(tradeId)
        .filter((entry) => !entry.deletedAt)
        .toArray();
      if (links.length === 0) return [];
      const tags = await db.tags.bulkGet(links.map((entry) => entry.tagId));
      return tags.filter((tag): tag is Tag => Boolean(tag && !tag.deletedAt));
    },
    [tradeId, user?.id]
  );
  const allTags = useMemo(() => (liveAllTags ?? []).map((tag) => normalizeTag(tag)), [liveAllTags]);
  const tradeTags = useMemo(
    () => (liveTradeTags ?? []).map((tag) => normalizeTag(tag)),
    [liveTradeTags]
  );
  const isLoading =
    Boolean(tradeId) && (liveAllTags === undefined || liveTradeTags === undefined);
  const [error, setError] = useState<Error | null>(null);

  const replaceTags = useCallback(
    async (tagIds: number[]) => {
      if (!tradeId) return;

      try {
        await tagRepo.replaceForTrade(tradeId, tagIds);
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
    refetch: async () => {},
  };
}
