"use client";

import { useEffect, useCallback } from "react";
import { useSyncProgressStore } from "@ui/state/syncProgressStore";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";
import { progressEventEmitter } from "@infrastructure/sync/ProgressEventEmitter";
import type { ISymbolSyncProgressRepository } from "@application/ports/repositories";

export interface UseSyncProgressOptions {
  /** Repository to load initial progress from */
  repository?: ISymbolSyncProgressRepository;
  /** Whether to auto-load progress on mount */
  autoLoad?: boolean;
  /** Whether to subscribe to progress events */
  subscribe?: boolean;
}

/**
 * useSyncProgress - Hook for accessing sync progress
 *
 * Provides access to sync progress state and updates.
 * Automatically subscribes to progress events if enabled.
 */
export function useSyncProgress(options: UseSyncProgressOptions = {}) {
  const {
    autoLoad = true,
    subscribe = true,
    repository,
  } = options;

  const {
    symbolProgress,
    overallProgress,
    updateSymbolProgress,
    updateMultipleProgress,
    removeSymbolProgress,
    clearProgress,
    getProgressByBroker,
    getProgressBySymbol,
    getProgressByStatus,
    getOverallProgress,
    loadProgress,
  } = useSyncProgressStore();

  // Load initial progress from repository (only once on mount)
  useEffect(() => {
    if (autoLoad && repository) {
      console.log(`[useSyncProgress] Loading progress from repository...`);
      let cancelled = false;
      
      repository
        .getAll()
        .then((progresses) => {
          if (cancelled) return;
          console.log(`[useSyncProgress] Loaded ${progresses.length} progress records`);
          loadProgress(progresses);
          console.log(`[useSyncProgress] Progress loaded into store`);
        })
        .catch((error) => {
          if (cancelled) return;
          console.error("[useSyncProgress] Failed to load sync progress:", error);
        });
      
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]); // Only depend on autoLoad, not repository or loadProgress to prevent loops

  // Subscribe to progress events
  useEffect(() => {
    if (!subscribe) return;

    const unsubscribe = progressEventEmitter.subscribe((progress) => {
      updateSymbolProgress(progress);
    });

    return unsubscribe;
  }, [subscribe, updateSymbolProgress]);

  // Helper functions
  const getProgress = useCallback(
    (broker: string, symbol: string): SymbolSyncProgress | null => {
      const key = `${broker}:${symbol}`;
      return symbolProgress.get(key) ?? null;
    },
    [symbolProgress]
  );

  const getBrokerProgress = useCallback(
    (broker: string): SymbolSyncProgress[] => {
      return getProgressByBroker(broker);
    },
    [getProgressByBroker]
  );

  const getStatusProgress = useCallback(
    (status: SymbolSyncStatus): SymbolSyncProgress[] => {
      return getProgressByStatus(status);
    },
    [getProgressByStatus]
  );

  const refreshProgress = useCallback(async () => {
    if (repository) {
      try {
        console.log(`[useSyncProgress] Refreshing progress from repository...`);
        const progresses = await repository.getAll();
        console.log(`[useSyncProgress] Refreshed ${progresses.length} progress records`);
        loadProgress(progresses);
        console.log(`[useSyncProgress] Progress refreshed in store`);
      } catch (error) {
        console.error("[useSyncProgress] Failed to refresh sync progress:", error);
      }
    } else {
      console.warn(`[useSyncProgress] No repository provided for refresh`);
    }
  }, [repository, loadProgress]);

  return {
    // State
    symbolProgress: Array.from(symbolProgress.values()),
    overallProgress,
    
    // Getters
    getProgress,
    getBrokerProgress,
    getStatusProgress,
    getOverallProgress,
    
    // Actions
    updateProgress: updateSymbolProgress,
    updateMultiple: updateMultipleProgress,
    removeProgress: removeSymbolProgress,
    clear: clearProgress,
    refresh: refreshProgress,
  };
}
