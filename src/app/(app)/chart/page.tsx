"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import {
  Mt5HistoryWorkspace,
  SyncedChartWorkspace,
  ChartTabBar,
  ChartLayoutSelector,
  ChartLayoutGrid,
  paneCountForLayout,
} from "@ui/components/charts";
import type { ChartTab, ChartPane, LayoutType } from "@ui/components/charts";
import { useChartTradeHistoryPanel } from "@ui/providers";

type ChartMode = "synced" | "history";

const CHART_MODE_KEY = "chartWorkspaceMode";
const SYNCED_TABS_KEY = "chartTabs_synced";
const SYNCED_ACTIVE_KEY = "chartActiveTab_synced";
const HISTORY_TABS_KEY = "chartTabs_history";
const HISTORY_ACTIVE_KEY = "chartActiveTab_history";
function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function makePane(symbol = "", broker?: string): ChartPane {
  return { id: generateId(), symbol, broker };
}

function makeTab(symbol = "", broker?: string): ChartTab {
  return {
    id: generateId(),
    layout: "single",
    panes: [makePane(symbol, broker)],
    activePaneIndex: 0,
  };
}

function readStoredMode(): ChartMode {
  if (typeof window === "undefined") return "synced";
  try {
    const raw = window.localStorage.getItem(CHART_MODE_KEY);
    if (raw === "synced" || raw === "history") return raw;
  } catch {
    // ignore
  }
  return "synced";
}

function readStoredTabs(key: string): ChartTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].panes) return parsed;
  } catch {
    // ignore
  }
  return [];
}

function readStoredActiveTab(key: string, tabs: ChartTab[]): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    if (stored && tabs.some((tab) => tab.id === stored)) return stored;
  } catch {
    // ignore
  }
  return tabs[0]?.id ?? "";
}

function tabsKeyForMode(mode: ChartMode) {
  return mode === "synced" ? SYNCED_TABS_KEY : HISTORY_TABS_KEY;
}

function activeKeyForMode(mode: ChartMode) {
  return mode === "synced" ? SYNCED_ACTIVE_KEY : HISTORY_ACTIVE_KEY;
}

function createInitialModeState(mode: ChartMode): { tabs: ChartTab[]; activeId: string } {
  const storedTabs = readStoredTabs(tabsKeyForMode(mode));
  const tabs = storedTabs.length > 0 ? storedTabs : [makeTab()];
  return {
    tabs,
    activeId: readStoredActiveTab(activeKeyForMode(mode), tabs),
  };
}

export default function ChartPage() {
  const [mode, setMode] = useState<ChartMode>(() => readStoredMode());
  const [historyAvailabilityText, setHistoryAvailabilityText] = useState<string | null>(null);
  const [syncTimeframes, setSyncTimeframes] = useState(false);
  const {
    panel: tradePanel,
    setPanel: handleTradePanelChange,
  } = useChartTradeHistoryPanel();

  const [syncedInitial] = useState(() => createInitialModeState("synced"));
  const [historyInitial] = useState(() => createInitialModeState("history"));
  const [syncedTabs, setSyncedTabs] = useState<ChartTab[]>(() => syncedInitial.tabs);
  const [syncedActiveId, setSyncedActiveId] = useState<string>(() => syncedInitial.activeId);
  const [historyTabs, setHistoryTabs] = useState<ChartTab[]>(() => historyInitial.tabs);
  const [historyActiveId, setHistoryActiveId] = useState<string>(() => historyInitial.activeId);

  const tabs = mode === "synced" ? syncedTabs : historyTabs;
  const activeTabId = mode === "synced" ? syncedActiveId : historyActiveId;

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );
  const isMultiPane = (activeTab?.layout ?? "single") !== "single";
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_MODE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SYNCED_TABS_KEY, JSON.stringify(syncedTabs));
  }, [syncedTabs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SYNCED_ACTIVE_KEY, syncedActiveId);
  }, [syncedActiveId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HISTORY_TABS_KEY, JSON.stringify(historyTabs));
  }, [historyTabs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HISTORY_ACTIVE_KEY, historyActiveId);
  }, [historyActiveId]);

  useEffect(() => {
    if (mode !== "synced") {
      handleTradePanelChange(null);
    }
  }, [handleTradePanelChange, mode]);

  useEffect(() => {
    return () => {
      handleTradePanelChange(null);
    };
  }, [handleTradePanelChange]);

  const handleTabSelect = useCallback((tabId: string) => {
    if (mode === "synced") {
      setSyncedActiveId(tabId);
    } else {
      setHistoryActiveId(tabId);
    }
  }, [mode]);

  const handleTabClose = useCallback(
    (tabId: string) => {
      const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
      const setActiveId = mode === "synced" ? setSyncedActiveId : setHistoryActiveId;

      setTabs((previous) => {
        if (previous.length <= 1) return previous;
        const next = previous.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          const closedIndex = previous.findIndex((tab) => tab.id === tabId);
          const newActive = next[Math.min(closedIndex, next.length - 1)];
          setActiveId(newActive.id);
        }
        return next;
      });
    },
    [activeTabId, mode]
  );

  const handleTabAdd = useCallback(() => {
    const newTab = makeTab();
    if (mode === "synced") {
      setSyncedTabs((previous) => [...previous, newTab]);
      setSyncedActiveId(newTab.id);
    } else {
      setHistoryTabs((previous) => [...previous, newTab]);
      setHistoryActiveId(newTab.id);
    }
  }, [mode]);

  const handleTabDuplicate = useCallback((tabId: string) => {
    const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
    const setActiveId = mode === "synced" ? setSyncedActiveId : setHistoryActiveId;

    setTabs((previous) => {
      const source = previous.find((tab) => tab.id === tabId);
      if (!source) return previous;

      const duplicate: ChartTab = {
        ...source,
        id: generateId(),
        panes: source.panes.map((pane) => ({ ...pane, id: generateId() })),
      };

      const sourceIndex = previous.findIndex((tab) => tab.id === tabId);
      const next = [...previous];
      next.splice(sourceIndex + 1, 0, duplicate);
      setActiveId(duplicate.id);
      return next;
    });
  }, [mode]);

  const handleTabReorder = useCallback((reordered: ChartTab[]) => {
    if (mode === "synced") {
      setSyncedTabs(reordered);
    } else {
      setHistoryTabs(reordered);
    }
  }, [mode]);

  const handleLayoutChange = useCallback(
    (layout: LayoutType) => {
      const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
      setTabs((previous) =>
        previous.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const needed = paneCountForLayout(layout);
          let panes = [...tab.panes];
          while (panes.length < needed) panes.push(makePane());
          if (panes.length > needed) panes = panes.slice(0, needed);
          return {
            ...tab,
            layout,
            panes,
            activePaneIndex: Math.min(tab.activePaneIndex, needed - 1),
          };
        })
      );
    },
    [activeTabId, mode]
  );

  const handleActivePaneChange = useCallback((tabId: string, index: number) => {
    const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
    setTabs((previous) =>
      previous.map((tab) => (tab.id === tabId ? { ...tab, activePaneIndex: index } : tab))
    );
  }, [mode]);

  const updatePaneField = useCallback(
    (tabId: string, paneIndex: number, fields: Partial<ChartPane>) => {
      const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
      setTabs((previous) =>
        previous.map((tab) => {
          if (tab.id !== tabId) return tab;
          const panes = tab.panes.map((pane, index) =>
            index === paneIndex ? { ...pane, ...fields } : pane
          );
          return { ...tab, panes };
        })
      );
    },
    [mode]
  );

  const handleTimeframeChangeForPane = useCallback(
    (tabId: string, paneIndex: number, timeframe: string) => {
      if (syncTimeframes) {
        const setTabs = mode === "synced" ? setSyncedTabs : setHistoryTabs;
        setTabs((previous) =>
          previous.map((tab) => {
            if (tab.id !== tabId) return tab;
            return {
              ...tab,
              panes: tab.panes.map((pane) => ({ ...pane, timeframe })),
            };
          })
        );
      } else {
        updatePaneField(tabId, paneIndex, { timeframe });
      }
    },
    [mode, syncTimeframes, updatePaneField]
  );

  const renderPaneForTab = useCallback(
    (
      tabId: string,
      isMulti: boolean,
      tabIsVisible: boolean,
      pane: ChartPane,
      index: number,
      paneIsActive: boolean
    ) => {
      const onSyncedSymbolChange = (symbol: string, broker: string) => {
        updatePaneField(tabId, index, { symbol, broker });
      };

      const onMt5SymbolChange = (symbol: string) => {
        updatePaneField(tabId, index, { symbol });
      };

      const onTimeframeChange = (timeframe: string) => {
        handleTimeframeChangeForPane(tabId, index, timeframe);
      };

      if (mode === "synced") {
        return (
          <SyncedChartWorkspace
            key={pane.id}
            initialSymbol={pane.symbol || undefined}
            initialBroker={pane.broker || undefined}
            onSymbolChange={onSyncedSymbolChange}
            onTimeframeChange={onTimeframeChange}
            isActive={tabIsVisible && (!isMulti || paneIsActive)}
            onTradePanelChange={handleTradePanelChange}
            compact={isMulti}
          />
        );
      }

      return (
        <Mt5HistoryWorkspace
          key={pane.id}
          onAvailabilityTextChange={index === 0 ? setHistoryAvailabilityText : undefined}
          initialSymbol={pane.symbol || undefined}
          onSymbolChange={onMt5SymbolChange}
          onTimeframeChange={onTimeframeChange}
          isActive={tabIsVisible && (!isMulti || paneIsActive)}
          compact={isMulti}
        />
      );
    },
    [handleTimeframeChangeForPane, handleTradePanelChange, mode, updatePaneField]
  );

  return (
    <div className={`flex h-full min-h-0 ${tradePanel ? "md:-mr-10" : "md:-mr-6"}`}>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3" />

        <div className="flex w-full flex-wrap items-center gap-2 md:gap-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode("synced")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "synced"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              Synced Chart
            </button>
            <button
              type="button"
              onClick={() => setMode("history")}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === "history"
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              MT5 History
            </button>
          </div>
          <div className="ml-auto min-w-0 basis-full md:basis-auto">
            <p className="mt-1 text-sm text-muted-foreground md:mt-0 md:text-right">
              {mode === "synced"
                ? "workspace"
                : historyAvailabilityText ?? "Loading MT5 history availability..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ChartTabBar
              tabs={tabs}
              activeTabId={activeTabId}
              onTabSelect={handleTabSelect}
              onTabClose={handleTabClose}
              onTabAdd={handleTabAdd}
              onTabDuplicate={handleTabDuplicate}
              onTabReorder={handleTabReorder}
            />
          </div>

          {isMultiPane ? (
            <button
              type="button"
              onClick={() => setSyncTimeframes((previous) => !previous)}
              className={`flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors ${
                syncTimeframes
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              title={syncTimeframes ? "Timeframes synced across panes" : "Sync timeframes across panes"}
            >
              {syncTimeframes ? (
                <Link2 className="h-3.5 w-3.5" />
              ) : (
                <Link2Off className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">Sync TF</span>
            </button>
          ) : null}

          <ChartLayoutSelector
            value={activeTab?.layout ?? "single"}
            onChange={handleLayoutChange}
          />
        </div>

        {tabs.map((tab) => {
          const isVisible = tab.id === activeTabId;
          const isMulti = tab.layout !== "single";
          return (
            <div
              key={tab.id}
              className={`min-h-0 flex-1 flex-col ${isVisible ? "flex" : "hidden"}`}
            >
              <ChartLayoutGrid
                layout={tab.layout}
                panes={tab.panes}
                activePaneIndex={tab.activePaneIndex}
                onActivePaneChange={(index) => handleActivePaneChange(tab.id, index)}
                renderPane={(pane, index, paneIsActive) =>
                  renderPaneForTab(tab.id, isMulti, isVisible, pane, index, paneIsActive)
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
