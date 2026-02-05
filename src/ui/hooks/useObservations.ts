"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Observation } from "@domain/entities";
import { DexieObservationRepository } from "@infrastructure/db/dexie";

const repo = new DexieObservationRepository();

function toTimeMs(v: Date | string | undefined | null): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  return new Date(v).getTime();
}

export interface UseObservationsFilters {
  from?: Date;
  to?: Date;
  categoryId?: number | null;
}

export function useObservations(filters?: UseObservationsFilters) {
  const [observations, setObservations] = useState<Observation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const list = await repo.list(filters?.categoryId ?? undefined);
      setObservations(list);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load observations"));
      setObservations([]);
    } finally {
      setIsLoading(false);
    }
  }, [filters?.categoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!filters?.from && !filters?.to) return observations;
    const fromMs = filters.from ? toTimeMs(filters.from) : 0;
    const toMs = filters.to ? toTimeMs(filters.to) : Number.MAX_SAFE_INTEGER;
    return observations.filter((obs) => {
      const created = toTimeMs(obs.createdAt);
      return created >= fromMs && created <= toMs;
    });
  }, [observations, filters?.from, filters?.to]);

  return { observations: filtered, isLoading, error, refetch: load };
}
