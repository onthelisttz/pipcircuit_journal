"use client";

import { useState, useCallback, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Tag } from "@domain/entities";
import { createTagRepository } from "@infrastructure/db/createDualRepositories";
import { db } from "@infrastructure/db/dexie/database";
import { useAuth } from "@ui/hooks/useAuth";

export function useTagsList() {
  const { user } = useAuth();
  const tagRepo = useMemo(() => createTagRepository(user?.id), [user?.id]);
  const liveTags = useLiveQuery(
    () => db.tags.filter((tag) => !tag.deletedAt).sortBy("name"),
    [user?.id]
  );
  const tags = liveTags ?? [];
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
