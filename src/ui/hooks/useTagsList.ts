"use client";

import { useState, useEffect, useCallback } from "react";
import type { Tag } from "@domain/entities";
import type { TagCategory } from "@domain/enums";
import { DexieTagRepository } from "@infrastructure/db/dexie";

const tagRepo = new DexieTagRepository();

export function useTagsList() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await tagRepo.list();
      setTags(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load tags"));
      setTags([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (tag: Omit<Tag, "id">) => {
      const now = new Date();
      const created = await tagRepo.create({
        ...tag,
        createdAt: now,
        updatedAt: now,
      });
      setTags((prev) => [...prev, created]);
      return created;
    },
    []
  );

  const update = useCallback(
    async (id: number, updates: Partial<Pick<Tag, "name" | "category" | "color">>) => {
      const now = new Date();
      const updated = await tagRepo.update(id, { ...updates, updatedAt: now });
      setTags((prev) => prev.map((t) => (t.id === id ? updated : t)));
      return updated;
    },
    []
  );

  const remove = useCallback(async (id: number) => {
    await tagRepo.delete(id);
    setTags((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { tags, isLoading, error, create, update, remove, refetch: load };
}
