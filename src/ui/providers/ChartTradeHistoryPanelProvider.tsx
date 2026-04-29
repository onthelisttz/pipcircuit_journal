"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChartTradeHistoryPanelData } from "@ui/components/charts/ChartTradeHistoryPanel";

interface ChartTradeHistoryPanelContextValue {
  panel: ChartTradeHistoryPanelData | null;
  setPanel: (panel: ChartTradeHistoryPanelData | null) => void;
}

const ChartTradeHistoryPanelContext =
  createContext<ChartTradeHistoryPanelContextValue | null>(null);

export function ChartTradeHistoryPanelProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<ChartTradeHistoryPanelData | null>(null);

  const setPanel = useCallback((nextPanel: ChartTradeHistoryPanelData | null) => {
    setPanelState((current) => {
      if (nextPanel == null) {
        return current == null ? current : null;
      }

      if (
        current &&
        current.symbol === nextPanel.symbol &&
        current.broker === nextPanel.broker &&
        current.selectedTradeId === nextPanel.selectedTradeId &&
        current.trades === nextPanel.trades &&
        current.liveModeEnabled === nextPanel.liveModeEnabled &&
        current.livePositions === nextPanel.livePositions &&
        current.liveOrders === nextPanel.liveOrders &&
        current.liveBidPrice === nextPanel.liveBidPrice &&
        current.liveAskPrice === nextPanel.liveAskPrice &&
        current.onSelectTrade === nextPanel.onSelectTrade &&
        current.onClosePosition === nextPanel.onClosePosition &&
        current.onCancelOrder === nextPanel.onCancelOrder &&
        current.onClose === nextPanel.onClose
      ) {
        return current;
      }

      return nextPanel;
    });
  }, []);

  const value = useMemo(
    () => ({
      panel,
      setPanel,
    }),
    [panel, setPanel]
  );

  return (
    <ChartTradeHistoryPanelContext.Provider value={value}>
      {children}
    </ChartTradeHistoryPanelContext.Provider>
  );
}

export function useChartTradeHistoryPanel() {
  const context = useContext(ChartTradeHistoryPanelContext);
  if (!context) {
    throw new Error("useChartTradeHistoryPanel must be used within ChartTradeHistoryPanelProvider");
  }
  return context;
}
