"use client";

import { useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { ObservationCategory } from "@domain/entities";
import { db } from "@infrastructure/db/dexie/database";
import { useAuth } from "@ui/hooks/useAuth";

export function useObservationCategories() {
  const { user } = useAuth();
  const liveCategories = useLiveQuery(
    () => db.observation_categories.filter((category) => !category.deletedAt).sortBy("name"),
    [user?.id]
  );
  const categories = (liveCategories ?? []) as ObservationCategory[];
  const isLoading = liveCategories === undefined;
  const error = null;
  const refetch = useCallback(async () => {}, []);

  return { categories, isLoading, error, refetch };
}
