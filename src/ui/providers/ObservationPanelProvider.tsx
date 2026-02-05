"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface ObservationPanelState {
  isOpen: boolean;
  observationId: number | null;
  observationIds: number[];
}

interface ObservationPanelContextValue extends ObservationPanelState {
  openPanel: (observationId: number, observationIds?: number[]) => void;
  closePanel: () => void;
  goToNext: () => void;
  goToPrev: () => void;
}

const ObservationPanelContext = createContext<ObservationPanelContextValue | null>(null);

export function ObservationPanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ObservationPanelState>({
    isOpen: false,
    observationId: null,
    observationIds: [],
  });

  const openPanel = useCallback((observationId: number, observationIds?: number[]) => {
    setState({
      isOpen: true,
      observationId,
      observationIds: observationIds ?? [observationId],
    });
  }, []);

  const closePanel = useCallback(() => {
    setState((s) => ({ ...s, isOpen: false, observationId: null, observationIds: [] }));
  }, []);

  const goToNext = useCallback(() => {
    setState((s) => {
      if (!s.observationId || s.observationIds.length === 0) return s;
      const idx = s.observationIds.indexOf(s.observationId);
      const nextIdx = idx < s.observationIds.length - 1 ? idx + 1 : idx;
      return { ...s, observationId: s.observationIds[nextIdx] ?? s.observationId };
    });
  }, []);

  const goToPrev = useCallback(() => {
    setState((s) => {
      if (!s.observationId || s.observationIds.length === 0) return s;
      const idx = s.observationIds.indexOf(s.observationId);
      const prevIdx = idx > 0 ? idx - 1 : idx;
      return { ...s, observationId: s.observationIds[prevIdx] ?? s.observationId };
    });
  }, []);

  const value = useMemo<ObservationPanelContextValue>(
    () => ({
      ...state,
      openPanel,
      closePanel,
      goToNext,
      goToPrev,
    }),
    [state, openPanel, closePanel, goToNext, goToPrev]
  );

  return (
    <ObservationPanelContext.Provider value={value}>
      {children}
    </ObservationPanelContext.Provider>
  );
}

export function useObservationPanel() {
  const ctx = useContext(ObservationPanelContext);
  if (!ctx) {
    throw new Error("useObservationPanel must be used within ObservationPanelProvider");
  }
  return ctx;
}
