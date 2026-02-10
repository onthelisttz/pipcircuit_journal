import { create } from "zustand";

interface FullSyncProgressState {
  /** Current step description (e.g. "Pushing accounts…") or null when idle */
  syncStep: string | null;
  /** True while a full sync is running (from SyncInitializer or Data Sync "Sync now") */
  isSyncing: boolean;
  /** Last known sync message (kept after sync completes for global badge) */
  lastStep: string | null;
  setStep: (step: string | null) => void;
  setSyncing: (value: boolean) => void;
  /** Call at start of sync: isSyncing = true, step = initial */
  startSync: (initialStep?: string) => void;
  /** Call on each progress update */
  updateStep: (step: string) => void;
  /** Call when sync finishes */
  finishSync: () => void;
}

export const useFullSyncProgressStore = create<FullSyncProgressState>((set) => ({
  syncStep: null,
  isSyncing: false,
  lastStep: null,

  setStep: (syncStep) => set({ syncStep, lastStep: syncStep }),
  setSyncing: (isSyncing) => set({ isSyncing }),

  startSync: (initialStep = "Starting…") =>
    set({ isSyncing: true, syncStep: initialStep, lastStep: initialStep }),

  updateStep: (syncStep) => set({ syncStep, lastStep: syncStep }),

  finishSync: () => set({ isSyncing: false, syncStep: null }),
}));
