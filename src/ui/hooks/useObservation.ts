"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Observation } from "@domain/entities";
import { createObservationRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

export function useObservation(id: number | null) {
  const { user } = useAuth();
  const repo = useMemo(() => createObservationRepository(user?.id), [user?.id]);
  const [observation, setObservation] = useState<Observation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    if (id == null) {
      setObservation(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const obs = await repo.getById(id);
      setObservation(obs);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Failed to load observation"));
      setObservation(null);
    } finally {
      setIsLoading(false);
    }
  }, [id, repo]);

  useEffect(() => {
    void load();
  }, [load]);

  return { observation, isLoading, error, refetch: load };
}
