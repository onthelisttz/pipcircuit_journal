import { create } from "zustand";
import type { SymbolSyncProgress, SymbolSyncStatus } from "@domain/entities";

export interface OverallProgress {
  totalSymbols: number;
  completedSymbols: number;
  syncingSymbols: number;
  failedSymbols: number;
  pendingSymbols: number;
  totalBarsSynced: number;
  overallProgressPercent: number;
}

interface SyncProgressState {
  // Per-symbol progress map: key = "broker:symbol"
  symbolProgress: Map<string, SymbolSyncProgress>;
  
  // Overall progress statistics
  overallProgress: OverallProgress;
  
  // Actions
  updateSymbolProgress: (progress: SymbolSyncProgress) => void;
  updateMultipleProgress: (progresses: SymbolSyncProgress[]) => void;
  removeSymbolProgress: (broker: string, symbol: string) => void;
  clearProgress: () => void;
  
  // Getters
  getProgressByBroker: (broker: string) => SymbolSyncProgress[];
  getProgressBySymbol: (symbol: string) => SymbolSyncProgress[];
  getProgressByStatus: (status: SymbolSyncStatus) => SymbolSyncProgress[];
  getOverallProgress: () => OverallProgress;
  
  // Load from repository
  loadProgress: (progresses: SymbolSyncProgress[]) => void;
}

function calculateOverallProgress(
  symbolProgress: Map<string, SymbolSyncProgress>
): OverallProgress {
  const progresses = Array.from(symbolProgress.values());
  
  const totalSymbols = progresses.length;
  const completedSymbols = progresses.filter((p) => p.status === "completed").length;
  const syncingSymbols = progresses.filter((p) => p.status === "syncing").length;
  const failedSymbols = progresses.filter((p) => p.status === "failed").length;
  const pendingSymbols = progresses.filter((p) => p.status === "pending").length;
  const totalBarsSynced = progresses.reduce((sum, p) => sum + (p.totalBars || 0), 0);
  
  // Overall progress = fraction of symbols completed (not average of per-symbol progressPercent)
  const overallProgressPercent =
    totalSymbols > 0
      ? Math.round((completedSymbols / totalSymbols) * 100)
      : 0;

  return {
    totalSymbols,
    completedSymbols,
    syncingSymbols,
    failedSymbols,
    pendingSymbols,
    totalBarsSynced,
    overallProgressPercent,
  };
}

function getProgressKey(broker: string, symbol: string): string {
  return `${broker}:${symbol}`;
}

export const useSyncProgressStore = create<SyncProgressState>((set, get) => ({
  symbolProgress: new Map(),
  overallProgress: {
    totalSymbols: 0,
    completedSymbols: 0,
    syncingSymbols: 0,
    failedSymbols: 0,
    pendingSymbols: 0,
    totalBarsSynced: 0,
    overallProgressPercent: 0,
  },

  updateSymbolProgress: (progress) => {
    set((state) => {
      const newMap = new Map(state.symbolProgress);
      const key = getProgressKey(progress.broker, progress.symbol);
      newMap.set(key, progress);
      
      return {
        symbolProgress: newMap,
        overallProgress: calculateOverallProgress(newMap),
      };
    });
  },

  updateMultipleProgress: (progresses) => {
    set((state) => {
      const newMap = new Map(state.symbolProgress);
      
      for (const progress of progresses) {
        const key = getProgressKey(progress.broker, progress.symbol);
        newMap.set(key, progress);
      }
      
      return {
        symbolProgress: newMap,
        overallProgress: calculateOverallProgress(newMap),
      };
    });
  },

  removeSymbolProgress: (broker, symbol) => {
    set((state) => {
      const newMap = new Map(state.symbolProgress);
      const key = getProgressKey(broker, symbol);
      newMap.delete(key);
      
      return {
        symbolProgress: newMap,
        overallProgress: calculateOverallProgress(newMap),
      };
    });
  },

  clearProgress: () => {
    set({
      symbolProgress: new Map(),
      overallProgress: {
        totalSymbols: 0,
        completedSymbols: 0,
        syncingSymbols: 0,
        failedSymbols: 0,
        pendingSymbols: 0,
        totalBarsSynced: 0,
        overallProgressPercent: 0,
      },
    });
  },

  getProgressByBroker: (broker) => {
    const state = get();
    return Array.from(state.symbolProgress.values()).filter(
      (p) => p.broker === broker
    );
  },

  getProgressBySymbol: (symbol) => {
    const state = get();
    return Array.from(state.symbolProgress.values()).filter(
      (p) => p.symbol === symbol
    );
  },

  getProgressByStatus: (status) => {
    const state = get();
    return Array.from(state.symbolProgress.values()).filter(
      (p) => p.status === status
    );
  },

  getOverallProgress: () => {
    return get().overallProgress;
  },

  loadProgress: (progresses) => {
    set((state) => {
      const newMap = new Map(state.symbolProgress);
      
      for (const progress of progresses) {
        const key = getProgressKey(progress.broker, progress.symbol);
        newMap.set(key, progress);
      }
      
      return {
        symbolProgress: newMap,
        overallProgress: calculateOverallProgress(newMap),
      };
    });
  },
}));
