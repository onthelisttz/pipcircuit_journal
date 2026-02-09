"use client";

import { useSyncProgressStore } from "@ui/state/syncProgressStore";
import type { OverallProgress } from "@ui/state/syncProgressStore";

/**
 * useOverallProgress - Hook for accessing overall sync progress
 *
 * Provides reactive access to overall sync statistics.
 */
export function useOverallProgress(): OverallProgress {
  return useSyncProgressStore((state) => state.overallProgress);
}
