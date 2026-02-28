"use client";

import { useState, useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Tag } from "@domain/entities";
import { TagCategory } from "@domain/enums";
import { createTagRepository } from "@infrastructure/db/createDualRepositories";
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

export function useTagsList() {
  const { user } = useAuth();
  const tagRepo = useMemo(() => createTagRepository(user?.id), [user?.id]);
  const liveTags = useLiveQuery(
    () => db.tags.filter((tag) => !tag.deletedAt).sortBy("name"),
    [user?.id]
  );
  const tags = useMemo(() => (liveTags ?? []).map((tag) => normalizeTag(tag)), [liveTags]);
  const isLoading = liveTags === undefined;
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(
    async (tag: Omit<Tag, "id">) => {
      const now = new Date();
      try {
        return await tagRepo.create({
          ...tag,
          createdAt: now,
          updatedAt: now,
        });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to create tag"));
        throw err;
      }
    },
    [tagRepo]
  );

  const update = useCallback(
    async (id: number, updates: Partial<Pick<Tag, "name" | "category" | "color">>) => {
      const now = new Date();
      try {
        return await tagRepo.update(id, { ...updates, updatedAt: now });
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to update tag"));
        throw err;
      }
    },
    [tagRepo]
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await tagRepo.delete(id);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to delete tag"));
        throw err;
      }
    },
    [tagRepo]
  );

  const refetch = useCallback(async () => {}, []);

  return { tags, isLoading, error, create, update, remove, refetch };
}
