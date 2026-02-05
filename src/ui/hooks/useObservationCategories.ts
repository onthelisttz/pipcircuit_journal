"use client";

import { useState, useEffect, useCallback } from "react";
import type { ObservationCategory } from "@domain/entities";
import { DexieObservationRepository } from "@infrastructure/db/dexie";

const repo = new DexieObservationRepository();

export function useObservationCategories() {
  const [categories, setCategories] = useState<ObservationCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await repo.listCategories();
      setCategories(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load categories"));
      setCategories([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { categories, isLoading, error, refetch: load };
}
