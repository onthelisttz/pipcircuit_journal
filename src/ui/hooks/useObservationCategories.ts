"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { ObservationCategory } from "@domain/entities";
import { createObservationRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useObservationCategories() {
  const { user } = useAuth();
  const repo = useMemo(() => createObservationRepository(user?.id), [user?.id]);
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
  }, [repo]);

  useEffect(() => {
    void load();
  }, [load]);

  return { categories, isLoading, error, refetch: load };
}
