"use client";

import { useCallback } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { startOfDay, endOfDay } from "date-fns";
import type { Observation, ObservationSource } from "@domain/entities";
import { db } from "@infrastructure/db/dexie/database";
import { useAuth } from "@ui/hooks/useAuth";

function toTimeMs(v: Date | string | undefined | null): number {
  if (v == null) return 0;
  if (v instanceof Date) return v.getTime();
  return new Date(v).getTime();
}

export interface UseObservationsFilters {
  from?: Date;
  to?: Date;
  categoryId?: number | null;
  source?: ObservationSource | "all";
}

function getObservationSource(observation: Observation): ObservationSource {
  if (observation.chartContext) return "chart";
  return observation.source ?? "manual";
}

export function useObservations(filters?: UseObservationsFilters) {
  const { user } = useAuth();
  const liveObservations = useLiveQuery(
    async () => {
      if (filters?.categoryId == null) {
        return db.observations.filter((obs) => !obs.deletedAt).toArray();
      }
      return db.observations
        .where("categoryId")
        .equals(filters.categoryId)
        .filter((obs) => !obs.deletedAt)
        .toArray();
    },
    [filters?.categoryId, user?.id]
  );
  const observations = (liveObservations ?? []) as Observation[];
  const isLoading = liveObservations === undefined;
  const error = null;

  const filtered = (() => {
    let next = observations;

    if (filters?.source && filters.source !== "all") {
      next = next.filter((obs) => getObservationSource(obs) === filters.source);
    }

    if (!filters?.from && !filters?.to) return next;
    const fromMs = filters.from ? startOfDay(filters.from).getTime() : 0;
    const toMs = filters.to ? endOfDay(filters.to).getTime() : Number.MAX_SAFE_INTEGER;
    return next.filter((obs) => {
      const created = toTimeMs(obs.createdAt);
      return created >= fromMs && created <= toMs;
    });
  })();

  const sorted = [...filtered].sort(
    (a, b) => toTimeMs(b.createdAt) - toTimeMs(a.createdAt)
  );

  const refetch = useCallback(async () => {}, []);

  return { observations: sorted, isLoading, error, refetch };
}
