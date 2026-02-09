"use client";

import { useSyncProgressStore } from "@ui/state/syncProgressStore";
import type { SymbolSyncProgress } from "@domain/entities";

/**
 * useSymbolProgress - Hook for accessing progress for a specific symbol
 *
 * Provides reactive access to progress for a single broker+symbol combination.
 */
export function useSymbolProgress(
  broker: string,
  symbol: string
): SymbolSyncProgress | null {
  const symbolProgress = useSyncProgressStore((state) => state.symbolProgress);
  const key = `${broker}:${symbol}`;
  return symbolProgress.get(key) ?? null;
}
