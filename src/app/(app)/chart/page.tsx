"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Link2, Link2Off } from "lucide-react";
import {
  Mt5HistoryWorkspace,
  SyncedChartWorkspace,
  ChartTabBar,
  ChartLayoutSelector,
  ChartLayoutGrid,
  paneCountForLayout,
} from "@ui/components/charts";
import type {
  ChartObservationLoadRequest,
  ChartObservationWorkspaceApi,
  ChartTab,
  ChartPane,
  LayoutType,
} from "@ui/components/charts";
import { useChartObservationPanel, useChartTradeHistoryPanel } from "@ui/providers";
import type { Observation, ObservationChartArea } from "@domain/entities";
import type { PriceAlertEvent } from "@ui/hooks/usePriceAlerts";

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

function makeObservationTab(
  mode: ChartMode,
  context: ObservationChartArea
): ChartTab {
  return {
    id: generateId(),
    layout: "single",
    panes: [
      {
        id: generateId(),
        symbol: context.symbol ?? "",
        broker: mode === "synced" ? context.broker ?? undefined : undefined,
        timeframe: context.timeframe ?? undefined,
      },
    ],
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

function paneMatchesObservation(
  pane: ChartPane,
  mode: ChartMode,
  context: ObservationChartArea
): boolean {
  if (!context.symbol || pane.symbol !== context.symbol) return false;
  if (mode === "synced" && context.broker) {
    return pane.broker === context.broker;
  }
  return true;
}

function findTabForObservation(
  tabs: ChartTab[],
  mode: ChartMode,
  context: ObservationChartArea
): { tabId: string; paneIndex: number } | null {
  for (const tab of tabs) {
    const paneIndex = tab.panes.findIndex((pane) => paneMatchesObservation(pane, mode, context));
    if (paneIndex >= 0) {
      return { tabId: tab.id, paneIndex };
    }
  }

  return null;
}

function inferAlertPriceDecimals(price: number): number {
  if (!Number.isFinite(price)) return 5;
  if (price >= 100000) return 0;
  if (price >= 10000) return 1;
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  return 5;
}

function formatAlertPrice(price: number): string {
  if (!Number.isFinite(price)) return "--";
  return price.toLocaleString(undefined, {
    minimumFractionDigits: inferAlertPriceDecimals(price),
    maximumFractionDigits: inferAlertPriceDecimals(price),
  });
}

function formatAlertCondition(condition: PriceAlertEvent["condition"]): string {
  return condition === "below" ? "Crosses Below" : "Crosses Above";
}

export default function ChartPage() {
  const [mode, setMode] = useState<ChartMode>(() => readStoredMode());
  const [showHeaderTabs, setShowHeaderTabs] = useState(true);
  const [historyAvailabilityText, setHistoryAvailabilityText] = useState<string | null>(null);
  const [syncTimeframes, setSyncTimeframes] = useState(false);
  const [workspaceHeaderControls, setWorkspaceHeaderControls] = useState<ReactNode | null>(null);
  const [isObservationPanelOpen, setIsObservationPanelOpen] = useState(false);
  const [isSyncedTradePanelOpen, setIsSyncedTradePanelOpen] = useState(false);
  const [triggeredAlertToasts, setTriggeredAlertToasts] = useState<PriceAlertEvent[]>([]);
  const [activeObservationWorkspace, setActiveObservationWorkspace] =
    useState<ChartObservationWorkspaceApi | null>(null);
  const [observationLoadRequest, setObservationLoadRequest] =
    useState<ChartObservationLoadRequest | null>(null);
  const {
    panel: tradePanel,
    setPanel: handleTradePanelChange,
  } = useChartTradeHistoryPanel();
  const { setPanel: setObservationPanel } = useChartObservationPanel();

  const [syncedInitial] = useState(() => createInitialModeState("synced"));
  const [historyInitial] = useState(() => createInitialModeState("history"));
  const [syncedTabs, setSyncedTabs] = useState<ChartTab[]>(() => syncedInitial.tabs);
  const [syncedActiveId, setSyncedActiveId] = useState<string>(() => syncedInitial.activeId);
  const [historyTabs, setHistoryTabs] = useState<ChartTab[]>(() => historyInitial.tabs);
  const [historyActiveId, setHistoryActiveId] = useState<string>(() => historyInitial.activeId);
  const toggleHeaderTabsVisibility = useCallback(() => {
    setShowHeaderTabs((previous) => !previous);
  }, []);

  const tabs = mode === "synced" ? syncedTabs : historyTabs;
  const activeTabId = mode === "synced" ? syncedActiveId : historyActiveId;
  const hasChartDock = Boolean(tradePanel || isObservationPanelOpen);

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

  const handleLoadObservation = useCallback((
    observation: Observation,
    contextOverride?: ObservationChartArea | null
  ) => {
    const context = contextOverride ?? observation.chartContext;
    if (!context) return;
    const targetMode = context.workspaceMode ?? mode;
    const targetTabs = targetMode === "synced" ? syncedTabs : historyTabs;
    const matchingTarget = findTabForObservation(targetTabs, targetMode, context);

    setMode(targetMode);
    if (matchingTarget) {
      if (targetMode === "synced") {
        setSyncedActiveId(matchingTarget.tabId);
        setSyncedTabs((previous) =>
          previous.map((tab) =>
            tab.id === matchingTarget.tabId
              ? { ...tab, activePaneIndex: matchingTarget.paneIndex }
              : tab
          )
        );
      } else {
        setHistoryActiveId(matchingTarget.tabId);
        setHistoryTabs((previous) =>
          previous.map((tab) =>
            tab.id === matchingTarget.tabId
              ? { ...tab, activePaneIndex: matchingTarget.paneIndex }
              : tab
          )
        );
      }
    } else {
      const newTab = makeObservationTab(targetMode, context);
      if (targetMode === "synced") {
        setSyncedTabs((previous) => [...previous, newTab]);
        setSyncedActiveId(newTab.id);
      } else {
        setHistoryTabs((previous) => [...previous, newTab]);
        setHistoryActiveId(newTab.id);
      }
    }
    setObservationLoadRequest({
      requestId: generateId(),
      observationId: observation.id ?? null,
      context,
    });
  }, [historyTabs, mode, syncedTabs]);

  useEffect(() => {
    if (!isObservationPanelOpen) {
      setObservationPanel(null);
      return;
    }

    setObservationPanel({
      workspace: activeObservationWorkspace,
      onLoadObservation: handleLoadObservation,
      onClose: () => setIsObservationPanelOpen(false),
    });

    return () => {
      setObservationPanel(null);
    };
  }, [
    activeObservationWorkspace,
    handleLoadObservation,
    isObservationPanelOpen,
    setObservationPanel,
  ]);

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

  const handleTriggeredAlertToast = useCallback((event: PriceAlertEvent) => {
    setTriggeredAlertToasts((current) => {
      if (current.some((item) => item.id === event.id)) {
        return current;
      }
      return [event, ...current].slice(0, 6);
    });
  }, []);

  const handleDismissTriggeredAlertToast = useCallback((eventId: string) => {
    setTriggeredAlertToasts((current) =>
      current.filter((event) => event.id !== eventId)
    );
  }, []);

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

      const onGoToDateChange = (goToDate?: string) => {
        updatePaneField(tabId, index, { goToDate });
      };

      if (mode === "synced") {
        return (
          <SyncedChartWorkspace
            key={pane.id}
            storageScopeKey={pane.id}
            initialSymbol={pane.symbol || undefined}
            initialBroker={pane.broker || undefined}
            initialTimeframe={pane.timeframe as "M1" | "M5" | "M15" | "H1" | undefined}
            initialGoToDate={pane.goToDate || undefined}
            onSymbolChange={onSyncedSymbolChange}
            onTimeframeChange={onTimeframeChange}
            onGoToDateChange={onGoToDateChange}
            onObservationApiChange={
              tabIsVisible && (!isMulti || paneIsActive)
                ? setActiveObservationWorkspace
                : undefined
            }
            observationLoadRequest={
              tabIsVisible && (!isMulti || paneIsActive)
                ? observationLoadRequest
                : null
            }
            onObservationLoadHandled={(requestId) =>
              setObservationLoadRequest((current) =>
                current?.requestId === requestId ? null : current
              )
            }
            isActive={tabIsVisible && (!isMulti || paneIsActive)}
            keepLiveSessionWarm={mode === "synced"}
            isTradePanelOpen={isSyncedTradePanelOpen}
            onTradePanelOpenChange={setIsSyncedTradePanelOpen}
            onAlertTriggered={handleTriggeredAlertToast}
            onTradePanelChange={
              tabIsVisible && (!isMulti || paneIsActive)
                ? handleTradePanelChange
                : undefined
            }
            onHeaderControlsChange={
              tabIsVisible && (!isMulti || paneIsActive)
                ? setWorkspaceHeaderControls
                : undefined
            }
            arePageTabsVisible={showHeaderTabs}
            onTogglePageTabsVisibility={toggleHeaderTabsVisibility}
            compact={isMulti}
          />
        );
      }

      return (
        <Mt5HistoryWorkspace
          key={pane.id}
          onAvailabilityTextChange={index === 0 ? setHistoryAvailabilityText : undefined}
          initialSymbol={pane.symbol || undefined}
          initialGoToDate={pane.goToDate || undefined}
          onSymbolChange={onMt5SymbolChange}
          onTimeframeChange={onTimeframeChange}
          onGoToDateChange={onGoToDateChange}
          onObservationApiChange={
            tabIsVisible && (!isMulti || paneIsActive)
              ? setActiveObservationWorkspace
              : undefined
          }
          observationLoadRequest={
            tabIsVisible && (!isMulti || paneIsActive)
              ? observationLoadRequest
              : null
          }
          onObservationLoadHandled={(requestId) =>
            setObservationLoadRequest((current) =>
              current?.requestId === requestId ? null : current
            )
          }
          isActive={tabIsVisible && (!isMulti || paneIsActive)}
          arePageTabsVisible={showHeaderTabs}
          onTogglePageTabsVisibility={toggleHeaderTabsVisibility}
          compact={isMulti}
        />
      );
    },
    [
      handleTimeframeChangeForPane,
      handleTriggeredAlertToast,
      handleTradePanelChange,
      isSyncedTradePanelOpen,
      mode,
      observationLoadRequest,
      showHeaderTabs,
      toggleHeaderTabsVisibility,
      updatePaneField,
    ]
  );

  return (
    <div className={`flex h-full min-h-0 ${hasChartDock ? "md:-mr-10" : "md:-mr-6"}`}>
      {mode === "synced" && triggeredAlertToasts.length > 0 ? (
        <div className="pointer-events-none fixed inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-3 sm:top-3">
          {triggeredAlertToasts.map((event) => (
            <div
              key={event.id}
              className="pointer-events-auto flex w-full max-w-2xl items-start justify-between gap-3 rounded-xl border border-white/10 bg-background/98 px-4 py-3 text-sm shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur"
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {event.symbol} alert triggered
                </p>
                <p className="text-muted-foreground">
                  {formatAlertCondition(event.condition)} on {event.priceSide.toUpperCase()} at{" "}
                  {formatAlertPrice(event.triggerPrice)}
                </p>
                {event.note ? (
                  <p className="mt-1 text-xs text-muted-foreground">{event.note}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => handleDismissTriggeredAlertToast(event.id)}
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Close
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3" />

        {showHeaderTabs ? (
          <>
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
                {mode === "synced" ? (
                  <div className="mt-1 md:mt-0 md:text-right">
                    {workspaceHeaderControls ?? (
                      <p className="text-sm text-muted-foreground">workspace</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground md:mt-0 md:text-right">
                    {historyAvailabilityText ?? "Loading MT5 history availability..."}
                  </p>
                )}
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
              <button
                type="button"
                onClick={() => setIsObservationPanelOpen((previous) => !previous)}
                className={`flex h-7 items-center gap-1.5 rounded border px-2 text-xs font-medium transition-colors ${
                  isObservationPanelOpen
                    ? "border-primary/60 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
                title="Toggle chart observations"
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Observations</span>
              </button>
            </div>
          </>
        ) : null}

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
