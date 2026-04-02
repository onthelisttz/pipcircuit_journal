"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  } catch { /* ignore */ }
  return "synced";
}

function readStoredTabs(key: string): ChartTab[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].panes) return parsed;
  } catch { /* ignore */ }
  return [];
}

function readStoredActiveTab(key: string, tabs: ChartTab[]): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(key) ?? "";
    if (stored && tabs.some((t) => t.id === stored)) return stored;
  } catch { /* ignore */ }
  return tabs[0]?.id ?? "";
}

function tabsKeyForMode(m: ChartMode) {
  return m === "synced" ? SYNCED_TABS_KEY : HISTORY_TABS_KEY;
}
function activeKeyForMode(m: ChartMode) {
  return m === "synced" ? SYNCED_ACTIVE_KEY : HISTORY_ACTIVE_KEY;
}

export default function ChartPage() {
  const [mode, setMode] = useState<ChartMode>(() => readStoredMode());
  const [historyAvailabilityText, setHistoryAvailabilityText] = useState<string | null>(null);
  const [syncTimeframes, setSyncTimeframes] = useState(false);

  // Per-mode tab state — compute once so tab IDs match between tabs and activeId
  const syncedInitRef = useRef<{ tabs: ChartTab[]; activeId: string } | null>(null);
  if (!syncedInitRef.current) {
    const t = readStoredTabs(tabsKeyForMode("synced"));
    const tabs = t.length > 0 ? t : [makeTab()];
    syncedInitRef.current = { tabs, activeId: readStoredActiveTab(activeKeyForMode("synced"), tabs) };
  }
  const historyInitRef = useRef<{ tabs: ChartTab[]; activeId: string } | null>(null);
  if (!historyInitRef.current) {
    const t = readStoredTabs(tabsKeyForMode("history"));
    const tabs = t.length > 0 ? t : [makeTab()];
    historyInitRef.current = { tabs, activeId: readStoredActiveTab(activeKeyForMode("history"), tabs) };
  }

  const [syncedTabs, setSyncedTabs] = useState<ChartTab[]>(syncedInitRef.current.tabs);
  const [syncedActiveId, setSyncedActiveId] = useState<string>(syncedInitRef.current.activeId);
  const [historyTabs, setHistoryTabs] = useState<ChartTab[]>(historyInitRef.current.tabs);
  const [historyActiveId, setHistoryActiveId] = useState<string>(historyInitRef.current.activeId);

  // Derived: current mode's tabs/active
  const tabs = mode === "synced" ? syncedTabs : historyTabs;
  const activeTabId = mode === "synced" ? syncedActiveId : historyActiveId;

  // Refs that always point to the current mode's setters (avoids stale closures)
  const setTabsRef = useRef(mode === "synced" ? setSyncedTabs : setHistoryTabs);
  const setActiveTabIdRef = useRef(mode === "synced" ? setSyncedActiveId : setHistoryActiveId);
  setTabsRef.current = mode === "synced" ? setSyncedTabs : setHistoryTabs;
  setActiveTabIdRef.current = mode === "synced" ? setSyncedActiveId : setHistoryActiveId;

  const activeTab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId]
  );

  const isMultiPane = (activeTab?.layout ?? "single") !== "single";

  // --- Persist ---
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

  // --- Tab operations ---
  const handleTabSelect = useCallback((tabId: string) => {
    setActiveTabIdRef.current(tabId);
  }, []);

  const handleTabClose = useCallback(
    (tabId: string) => {
      setTabsRef.current((prev) => {
        if (prev.length <= 1) return prev;
        const next = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          const closedIndex = prev.findIndex((t) => t.id === tabId);
          const newActive = next[Math.min(closedIndex, next.length - 1)];
          setActiveTabIdRef.current(newActive.id);
        }
        return next;
      });
    },
    [activeTabId]
  );

  const handleTabAdd = useCallback(() => {
    const newTab = makeTab();
    setTabsRef.current((prev) => [...prev, newTab]);
    setActiveTabIdRef.current(newTab.id);
  }, []);

  const handleTabDuplicate = useCallback(
    (tabId: string) => {
      setTabsRef.current((prev) => {
        const source = prev.find((t) => t.id === tabId);
        if (!source) return prev;
        const dup: ChartTab = {
          ...source,
          id: generateId(),
          panes: source.panes.map((p) => ({ ...p, id: generateId() })),
        };
        const idx = prev.findIndex((t) => t.id === tabId);
        const next = [...prev];
        next.splice(idx + 1, 0, dup);
        setActiveTabIdRef.current(dup.id);
        return next;
      });
    },
    []
  );

  const handleTabReorder = useCallback((reordered: ChartTab[]) => {
    setTabsRef.current(reordered);
  }, []);

  // --- Layout ---
  const handleLayoutChange = useCallback(
    (layout: LayoutType) => {
      setTabsRef.current((prev) =>
        prev.map((t) => {
          if (t.id !== activeTabId) return t;
          const needed = paneCountForLayout(layout);
          let panes = [...t.panes];
          while (panes.length < needed) panes.push(makePane());
          if (panes.length > needed) panes = panes.slice(0, needed);
          return { ...t, layout, panes, activePaneIndex: Math.min(t.activePaneIndex, needed - 1) };
        })
      );
    },
    [activeTabId]
  );

  const handleActivePaneChange = useCallback(
    (tabId: string, index: number) => {
      setTabsRef.current((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, activePaneIndex: index } : t))
      );
    },
    []
  );

  // --- Pane data updates (tab-aware) ---
  const updatePaneField = useCallback(
    (tabId: string, paneIndex: number, fields: Partial<ChartPane>) => {
      setTabsRef.current((prev) =>
        prev.map((t) => {
          if (t.id !== tabId) return t;
          const panes = t.panes.map((p, i) =>
            i === paneIndex ? { ...p, ...fields } : p
          );
          return { ...t, panes };
        })
      );
    },
    []
  );

  const handleTimeframeChangeForPane = useCallback(
    (tabId: string, paneIndex: number, timeframe: string) => {
      if (syncTimeframes) {
        setTabsRef.current((prev) =>
          prev.map((t) => {
            if (t.id !== tabId) return t;
            const panes = t.panes.map((p) => ({ ...p, timeframe }));
            return { ...t, panes };
          })
        );
      } else {
        updatePaneField(tabId, paneIndex, { timeframe });
      }
    },
    [syncTimeframes, updatePaneField]
  );

  // --- Render pane for a specific tab ---
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
    [mode, updatePaneField, handleTimeframeChangeForPane]
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* <div>
          <h1 className="text-2xl font-semibold text-foreground">Charts.</h1>
       
        </div> */}
      </div>

      {/* Mode toggles */}

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
              ? "One workspace for both your synced journal chart and the MT5 history viewer."
              : historyAvailabilityText ?? "Loading MT5 history availability..."}
          </p>
        </div>
      </div>
   

      {/* Tab bar + layout selector + sync toggle in one row */}
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

        {/* Sync timeframes toggle (only visible in multi-pane) */}
        {isMultiPane && (
          <button
            type="button"
            onClick={() => setSyncTimeframes((prev) => !prev)}
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
        )}

        <ChartLayoutSelector
          value={activeTab?.layout ?? "single"}
          onChange={handleLayoutChange}
        />
      </div>

      {/* All tabs rendered — inactive hidden via CSS to preserve state */}
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
  );
}
