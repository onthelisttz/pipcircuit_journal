"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { TradeQuery } from "@application/ports/repositories";

export interface TradePanelOpenOptions {
  title: string;
  /** Trade IDs to show (takes precedence over query) */
  tradeIds?: number[];
  /** Query to fetch trades (used when tradeIds not provided) */
  query?: TradeQuery;
  /** Pre-select this trade in the list when panel opens */
  selectedTradeId?: number | null;
}

interface TradePanelState {
  isOpen: boolean;
  title: string;
  tradeIds: number[] | null;
  query: TradeQuery | null;
  selectedTradeId: number | null;
}

interface TradePanelContextValue extends TradePanelState {
  openPanel: (options: TradePanelOpenOptions) => void;
  closePanel: () => void;
  setSelectedTradeId: (id: number | null) => void;
}

const TradePanelContext = createContext<TradePanelContextValue | null>(null);

export function TradePanelProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TradePanelState>({
    isOpen: false,
    title: "",
    tradeIds: null,
    query: null,
    selectedTradeId: null,
  });

  const openPanel = useCallback((options: TradePanelOpenOptions) => {
    setState({
      isOpen: true,
      title: options.title,
      tradeIds: options.tradeIds ?? null,
      query: options.query ?? null,
      selectedTradeId: options.selectedTradeId ?? null,
    });
  }, []);

  const closePanel = useCallback(() => {
    setState((s) => ({
      ...s,
      isOpen: false,
      selectedTradeId: null,
    }));
  }, []);

  const setSelectedTradeId = useCallback((id: number | null) => {
    setState((s) => ({ ...s, selectedTradeId: id }));
  }, []);

  const value = useMemo<TradePanelContextValue>(
    () => ({
      ...state,
      openPanel,
      closePanel,
      setSelectedTradeId,
    }),
    [state, openPanel, closePanel, setSelectedTradeId]
  );

  return (
    <TradePanelContext.Provider value={value}>
      {children}
    </TradePanelContext.Provider>
  );
}

export function useTradePanel() {
  const ctx = useContext(TradePanelContext);
  if (!ctx) {
    throw new Error("useTradePanel must be used within TradePanelProvider");
  }
  return ctx;
}
