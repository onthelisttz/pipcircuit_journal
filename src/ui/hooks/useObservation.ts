"use client";

import { useState, useEffect, useCallback } from "react";
import type { Observation } from "@domain/entities";
import { DexieObservationRepository } from "@infrastructure/db/dexie";

const repo = new DexieObservationRepository();

export function useObservation(id: number | null) {
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
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { observation, isLoading, error, refetch: load };
}
