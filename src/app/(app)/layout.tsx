"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";

import { AuthGuard, Header, Sidebar } from "@ui/components/layout";
import { TradePanel, ObservationPanel } from "@ui/components/panels";
import { ChartObservationDock, ChartTradeHistoryDock } from "@ui/components/charts";
import {
  TradePanelProvider,
  ObservationPanelProvider,
  ChartObservationPanelProvider,
  ChartTradeHistoryPanelProvider,
} from "@ui/providers";
import { useRealtimeSync } from "@ui/hooks/useRealtimeSync";
import { SyncInitializer } from "@ui/components/sync";

const HEADER_VISIBILITY_STORAGE_KEY = "personal-journal.header-visible";
const HEADER_VISIBILITY_EVENT = "personal-journal:header-visibility-change";

function getStoredHeaderVisibility(): boolean {
  if (typeof window === "undefined") return true;

  const storedValue = window.localStorage.getItem(HEADER_VISIBILITY_STORAGE_KEY);
  return storedValue === null ? true : storedValue === "true";
}

function subscribeToHeaderVisibility(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === HEADER_VISIBILITY_STORAGE_KEY) {
      callback();
    }
  };

  const handleVisibilityChange = () => {
    callback();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(HEADER_VISIBILITY_EVENT, handleVisibilityChange);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(HEADER_VISIBILITY_EVENT, handleVisibilityChange);
  };
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const isHeaderVisible = useSyncExternalStore(
    subscribeToHeaderVisibility,
    getStoredHeaderVisibility,
    () => true
  );

  // Start realtime sync when user is logged in
  useRealtimeSync();

  const toggleHeaderVisibility = () => {
    const nextValue = !isHeaderVisible;
    window.localStorage.setItem(HEADER_VISIBILITY_STORAGE_KEY, String(nextValue));
    window.dispatchEvent(new Event(HEADER_VISIBILITY_EVENT));
  };

  return (
    <AuthGuard>
      <TradePanelProvider>
        <ObservationPanelProvider>
          <ChartObservationPanelProvider>
            <ChartTradeHistoryPanelProvider>
              <SyncInitializer />
              <div className="flex h-screen overflow-hidden bg-background text-foreground">
                <Sidebar
                  className="hidden md:flex"
                  isHeaderVisible={isHeaderVisible}
                  onHeaderVisibilityToggle={toggleHeaderVisibility}
                />
                {isSidebarOpen && (
                  <div className="fixed inset-0 z-40 md:hidden">
                    <div
                      className="absolute inset-0 bg-black/60"
                      onClick={() => setIsSidebarOpen(false)}
                    />
                    <Sidebar
                      className="relative z-50 h-full shadow-xl"
                      forceCollapsed
                      hideCollapseToggle
                      isHeaderVisible={isHeaderVisible}
                      onHeaderVisibilityToggle={() => {
                        toggleHeaderVisibility();
                        setIsSidebarOpen(false);
                      }}
                      onNavigate={() => setIsSidebarOpen(false)}
                    />
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  {!isHeaderVisible && (
                    <button
                      onClick={() => setIsSidebarOpen(true)}
                      className="fixed left-3 top-3 z-30 rounded-lg border border-border bg-background/95 p-2 text-foreground shadow-md backdrop-blur md:hidden"
                      aria-label="Open navigation"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-4 w-4"
                      >
                        <line x1="4" x2="20" y1="12" y2="12" />
                        <line x1="4" x2="20" y1="6" y2="6" />
                        <line x1="4" x2="20" y1="18" y2="18" />
                      </svg>
                    </button>
                  )}
                  <div className={isHeaderVisible ? "" : "hidden"}>
                    <Header onMenuToggle={() => setIsSidebarOpen((prev) => !prev)} />
                  </div>
                  <main className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-0 sm:px-4 sm:pb-5 md:px-6 md:pr-10 md:pb-6">
                    {children}
                  </main>
                </div>
                <ChartObservationDock />
                <ChartTradeHistoryDock />
                <TradePanel />
                <ObservationPanel />
              </div>
            </ChartTradeHistoryPanelProvider>
          </ChartObservationPanelProvider>
        </ObservationPanelProvider>
      </TradePanelProvider>
    </AuthGuard>
  );
}
