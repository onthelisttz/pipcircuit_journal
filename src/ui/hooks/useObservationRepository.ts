"use client";

import { useMemo } from "react";
import type { IObservationRepository } from "@application/ports/repositories";
import { createObservationRepository } from "@infrastructure/db/createDualRepositories";
import { useAuth } from "@ui/hooks/useAuth";

/** Returns the observation repository (dual when logged in, Dexie-only when not). */
export function useObservationRepository(): IObservationRepository {
  const { user } = useAuth();
  return useMemo(() => createObservationRepository(user?.id), [user?.id]);
}
