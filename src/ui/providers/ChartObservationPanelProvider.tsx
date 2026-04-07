"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChartObservationPanelData } from "@ui/components/charts/chartObservationTypes";

interface ChartObservationPanelContextValue {
  panel: ChartObservationPanelData | null;
  setPanel: (panel: ChartObservationPanelData | null) => void;
}

const ChartObservationPanelContext =
  createContext<ChartObservationPanelContextValue | null>(null);

export function ChartObservationPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<ChartObservationPanelData | null>(null);

  const setPanel = useCallback((nextPanel: ChartObservationPanelData | null) => {
    setPanelState(nextPanel);
  }, []);

  const value = useMemo(
    () => ({
      panel,
      setPanel,
    }),
    [panel, setPanel]
  );

  return (
    <ChartObservationPanelContext.Provider value={value}>
      {children}
    </ChartObservationPanelContext.Provider>
  );
}

export function useChartObservationPanel() {
  const context = useContext(ChartObservationPanelContext);
  if (!context) {
    throw new Error("useChartObservationPanel must be used within ChartObservationPanelProvider");
  }
  return context;
}
