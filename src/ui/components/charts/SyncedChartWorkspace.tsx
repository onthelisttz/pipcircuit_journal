"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  RefreshCw,
  Eraser,
  ChevronDown,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Circle,
  Maximize2,
  Minimize2,
  Pencil,
  MoreVertical,
} from "lucide-react";
import type { ChartTimeframe, Trade } from "@domain/entities";
import { Direction, OrderType } from "@domain/enums";
import { TradeCandlestickChart } from "@ui/components/charts";
import type { DrawingToolType, TradeCandlestickChartRef } from "@ui/components/charts/TradeCandlestickChart";
import { useChartData } from "@ui/hooks/useChartData";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { useAccount } from "@ui/hooks/useAccount";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { TokenStorage } from "@infrastructure/auth";
import { hexToRgba } from "@lib/color";

const CHART_SELECTION_KEY = "chartSelection";
const CHART_TIMEFRAME_KEY = "chartTimeframe";
type ChartSelection = { broker: string; symbol: string };

const DRAW_TOOLS: { id: DrawingToolType; label: string }[] = [
  { id: "Path", label: "Path" },
  { id: "TrendLine", label: "Trendline" },
  { id: "Rectangle", label: "Rectangle" },
  { id: "LongShortPosition", label: "Long/Short" },
];

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1"];
const EDGE_FETCH_THRESHOLD = 10;

function readStoredSelection(): ChartSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CHART_SELECTION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { broker?: string; symbol?: string };
    if (parsed.broker && parsed.symbol) {
      return { broker: parsed.broker, symbol: parsed.symbol };
    }
  } catch {
    // ignore
  }
  return null;
}

function readStoredTimeframe(): ChartTimeframe {
  if (typeof window === "undefined") return "M1";
  try {
    const raw = window.localStorage.getItem(CHART_TIMEFRAME_KEY);
    if (raw === "M1" || raw === "M5" || raw === "M15" || raw === "H1") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "M1";
}

const PLACEHOLDER_TRADE: Trade = {
  accountId: "",
  symbol: "",
  direction: Direction.Buy,
  orderType: OrderType.Market,
  openTime: new Date(0),
  openPrice: 0,
  volume: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

function statusMeta(status?: string) {
  switch (status) {
    case "completed":
      return {
        label: "Completed",
        icon: CheckCircle2,
        color: "text-emerald-500",
      };
    case "syncing":
      return {
        label: "Syncing",
        icon: Clock3,
        color: "text-blue-500",
      };
    case "failed":
      return {
        label: "Failed",
        icon: AlertTriangle,
        color: "text-destructive",
      };
    default:
      return {
        label: "Pending",
        icon: Circle,
        color: "text-muted-foreground",
      };
  }
}

interface SyncedChartWorkspaceProps {
  initialSymbol?: string;
  initialBroker?: string;
  onSymbolChange?: (symbol: string, broker: string) => void;
  onTimeframeChange?: (timeframe: string) => void;
  /** Hide drawing tools & action buttons for compact multi-pane layouts */
  compact?: boolean;
}

export function SyncedChartWorkspace({
  initialSymbol,
  initialBroker,
  onSymbolChange,
  onTimeframeChange,
  compact = false,
}: SyncedChartWorkspaceProps = {}) {
  const { activeAccount, accounts } = useAccount();
  const progressRepo = useMemo(() => new DexieSymbolSyncProgressRepository(), []);

  const { symbolProgress } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  const [storedSelection, setStoredSelection] = useState<ChartSelection | null>(() => {
    if (initialSymbol && initialBroker) {
      return { broker: initialBroker, symbol: initialSymbol };
    }
    return readStoredSelection();
  });
  const selection = useMemo<ChartSelection | null>(() => {
    if (symbolProgress.length === 0) return storedSelection;
    if (
      storedSelection &&
      symbolProgress.some(
        (p) =>
          p.broker === storedSelection.broker && p.symbol === storedSelection.symbol
      )
    ) {
      return storedSelection;
    }
    const first = symbolProgress[0];
    return { broker: first.broker, symbol: first.symbol };
  }, [storedSelection, symbolProgress]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>(() =>
    readStoredTimeframe()
  );
  const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
  const [rectangleFillColor, setRectangleFillColor] = useState("#8b5cf6");
  const [rectangleFillOpacity, setRectangleFillOpacity] = useState(0.2);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState<DrawingToolType | null>(null);
  const [longShortLots, setLongShortLots] = useState(1);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(640);
  const lastPrevFetchRef = useRef(0);
  const lastNextFetchRef = useRef(0);
  const fetchingPrevRef = useRef(false);
  const fetchingNextRef = useRef(false);
  const lastVisibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const chartRef = useRef<TradeCandlestickChartRef | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const symbolButtonRef = useRef<HTMLButtonElement>(null);
  const symbolMenuRef = useRef<HTMLDivElement>(null);
  const timeframeButtonRef = useRef<HTMLButtonElement>(null);
  const timeframeMenuRef = useRef<HTMLDivElement>(null);
  const [chartAreaHeight, setChartAreaHeight] = useState(520);
  const [compactDrawOpen, setCompactDrawOpen] = useState(false);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const compactDrawRef = useRef<HTMLDivElement>(null);
  const compactActionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !selection) return;
    window.localStorage.setItem(CHART_SELECTION_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_TIMEFRAME_KEY, timeframe);
  }, [timeframe]);

  // Report initial values to parent so tab labels are correct on mount
  useEffect(() => {
    if (selection) onSymbolChange?.(selection.symbol, selection.broker);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.symbol, selection?.broker]);

  useEffect(() => {
    onTimeframeChange?.(timeframe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  useEffect(() => {
    if (!symbolMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !symbolMenuRef.current?.contains(target) &&
        !symbolButtonRef.current?.contains(target)
      ) {
        setSymbolMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSymbolMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [symbolMenuOpen]);

  useEffect(() => {
    if (!timeframeMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !timeframeMenuRef.current?.contains(target) &&
        !timeframeButtonRef.current?.contains(target)
      ) {
        setTimeframeMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTimeframeMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [timeframeMenuOpen]);

  useEffect(() => {
    if (!isExpanded) return;
    const updateHeight = () => {
      const available = window.innerHeight - 180;
      setExpandedHeight(Math.max(360, available));
    };
    updateHeight();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("resize", updateHeight);
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", updateHeight);
      window.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  useEffect(() => {
    if (isExpanded) return;
    const element = chartAreaRef.current;
    if (!element) return;

    const updateHeight = () => {
      setChartAreaHeight(Math.max(420, element.clientHeight || 0));
    };

    updateHeight();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateHeight())
        : null;
    observer?.observe(element);
    window.addEventListener("resize", updateHeight);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, [isExpanded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      const toggleTool = (tool: DrawingToolType) => {
        setDrawingTool((current) => (current === tool ? null : tool));
      };
      if (key === "t") {
        event.preventDefault();
        toggleTool("TrendLine");
      }
      if (key === "r") {
        event.preventDefault();
        toggleTool("Rectangle");
      }
      if (key === "p") {
        event.preventDefault();
        toggleTool("Path");
      }
      if (key === "s" || key === "l") {
        event.preventDefault();
        toggleTool("LongShortPosition");
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const selectedProgress = useMemo(() => {
    if (!selection) return null;
    return (
      symbolProgress.find(
        (p) => p.broker === selection.broker && p.symbol === selection.symbol
      ) ?? null
    );
  }, [symbolProgress, selection]);

  const windowDays = useMemo(() => {
    switch (timeframe) {
      case "M1":
        return 2;
      case "M5":
        return 5;
      case "M15":
        return 10;
      case "H1":
        return 30;
      default:
        return 2;
    }
  }, [timeframe]);

  const accountForBroker = useMemo(() => {
    if (!selection) return activeAccount ?? null;
    return (
      accounts.find((account) => account.broker === selection.broker) ??
      activeAccount ??
      null
    );
  }, [accounts, activeAccount, selection]);

  const chartTrade = useMemo<Trade | null>(() => {
    if (!selection) return null;
    const anchor = selectedProgress?.lastBarDate
      ? new Date(selectedProgress.lastBarDate)
      : new Date();
    const now = new Date();
    return {
      accountId: accountForBroker?.accountNumber ?? "",
      symbol: selection.symbol,
      direction: Direction.Buy,
      orderType: OrderType.Market,
      openTime: anchor,
      closeTime: anchor,
      openPrice: 0,
      volume: 0,
      createdAt: now,
      updatedAt: now,
    };
  }, [accountForBroker, selection, selectedProgress]);

  const accessToken = useMemo(() => {
    if (!accountForBroker) return undefined;
    return TokenStorage.getGlobal()?.accessToken;
  }, [accountForBroker]);

  const chartEnabled = Boolean(selection && chartTrade);

  const { data, isLoading, error, refetch, fetchPrevious, fetchNext } = useChartData({
    trade: chartTrade ?? PLACEHOLDER_TRADE,
    timeframe,
    accessToken,
    broker: selection?.broker,
    windowDays,
    enabled: chartEnabled,
  });

  const handleVisibleRangeChange = useCallback(
    (from: number, to: number) => {
      if (data.length === 0) return;

      const previousRange = lastVisibleRangeRef.current;
      const currentCenter = (from + to) / 2;
      const previousCenter = previousRange ? (previousRange.from + previousRange.to) / 2 : currentCenter;
      const panDirection = Math.sign(currentCenter - previousCenter);
      lastVisibleRangeRef.current = { from, to };

      const leftIndex = Math.floor(from);
      const rightIndex = Math.ceil(to);
      const nearLeft = leftIndex <= EDGE_FETCH_THRESHOLD;
      const nearRight = rightIndex >= data.length - EDGE_FETCH_THRESHOLD;

      let shouldFetchPrev = nearLeft;
      let shouldFetchNext = nearRight;

      // When both edges are visible (fast drags / broad zoom), fetch only in pan direction.
      if (nearLeft && nearRight) {
        if (panDirection < 0) {
          shouldFetchNext = false;
        } else if (panDirection > 0) {
          shouldFetchPrev = false;
        } else {
          shouldFetchPrev = false;
          shouldFetchNext = false;
        }
      }

      if (shouldFetchPrev && !fetchingPrevRef.current) {
        const now = Date.now();
        if (now - lastPrevFetchRef.current >= 800) {
          lastPrevFetchRef.current = now;
          fetchingPrevRef.current = true;
          void fetchPrevious().finally(() => {
            fetchingPrevRef.current = false;
          });
        }
      }

      if (shouldFetchNext && !fetchingNextRef.current) {
        const now = Date.now();
        if (now - lastNextFetchRef.current >= 800) {
          lastNextFetchRef.current = now;
          fetchingNextRef.current = true;
          void fetchNext().finally(() => {
            fetchingNextRef.current = false;
          });
        }
      }
    },
    [data.length, fetchNext, fetchPrevious]
  );

  useEffect(() => {
    fetchingPrevRef.current = false;
    fetchingNextRef.current = false;
    lastPrevFetchRef.current = 0;
    lastNextFetchRef.current = 0;
    lastVisibleRangeRef.current = null;
  }, [selection?.broker, selection?.symbol, timeframe]);

  const brokers = useMemo(() => {
    const map = new Map<string, typeof symbolProgress>();
    for (const progress of symbolProgress) {
      if (!map.has(progress.broker)) map.set(progress.broker, []);
      map.get(progress.broker)!.push(progress);
    }
    return Array.from(map.entries())
      .map(([broker, symbols]) => ({
        broker,
        symbols: symbols.sort((a, b) => a.symbol.localeCompare(b.symbol)),
      }))
      .sort((a, b) => a.broker.localeCompare(b.broker));
  }, [symbolProgress]);

  const hasSymbols = symbolProgress.length > 0;
  const selectedStatus = statusMeta(selectedProgress?.status);
  const SelectedStatusIcon = selectedStatus.icon;
  const drawingFillRgba = useMemo(
    () => hexToRgba(rectangleFillColor, rectangleFillOpacity),
    [rectangleFillColor, rectangleFillOpacity]
  );

  const toolbar = (
    <div className={`relative z-20 flex flex-wrap items-center gap-2 border-b border-border ${compact ? 'pb-1.5' : 'pb-3'}`}>
      <div className="relative">
        <button
          ref={symbolButtonRef}
          type="button"
          onClick={() => setSymbolMenuOpen((open) => !open)}
          disabled={!hasSymbols}
          className="flex h-7 items-center gap-2 rounded border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SelectedStatusIcon
            className={`h-3.5 w-3.5 ${selectedStatus.color}`}
            aria-label={selectedStatus.label}
          />
          <span className="max-w-[120px] truncate">
            {selection?.symbol ?? "Select symbol"}
          </span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {symbolMenuOpen && (
          <div
            ref={symbolMenuRef}
            className="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
          >
            {!hasSymbols && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No symbols synced.
              </div>
            )}
            {brokers.map((broker) => (
              <div key={broker.broker} className="py-1">
                <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {broker.broker}
                </div>
                {broker.symbols.map((symbol) => {
                  const isSelected =
                    selection?.broker === broker.broker &&
                    selection?.symbol === symbol.symbol;
                  const meta = statusMeta(symbol.status);
                  const StatusIcon = meta.icon;
                  return (
                    <button
                      key={`${broker.broker}-${symbol.symbol}`}
                      type="button"
                      onClick={() => {
                        setStoredSelection({
                          broker: broker.broker,
                          symbol: symbol.symbol,
                        });
                        onSymbolChange?.(symbol.symbol, broker.broker);
                        setSymbolMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                        isSelected
                          ? "bg-accent text-accent-foreground"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      <span className="font-medium">{symbol.symbol}</span>
                      <StatusIcon
                        className={`h-3.5 w-3.5 ${meta.color}`}
                        aria-label={meta.label}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          ref={timeframeButtonRef}
          type="button"
          onClick={() => setTimeframeMenuOpen((open) => !open)}
          disabled={!selection}
          className="flex h-7 items-center gap-2 rounded border border-border bg-background px-2 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>{timeframe}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>

        {timeframeMenuOpen && (
          <div
            ref={timeframeMenuRef}
            className="absolute left-0 top-full z-50 mt-1 w-28 rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
          >
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => {
                  setTimeframe(tf);
                  onTimeframeChange?.(tf);
                  setTimeframeMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  tf === timeframe
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-muted"
                }`}
              >
                <span className="font-medium">{tf}</span>
                {tf === timeframe && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {!compact ? (
        <div className="flex flex-wrap items-center gap-2">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() =>
                setDrawingTool((current) =>
                  current === tool.id ? null : tool.id
                )
              }
              disabled={!selection}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                drawingTool === tool.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {tool.label}
            </button>
          ))}
          {(() => {
            const showDrawControls =
              drawingTool === "Rectangle" ||
              drawingTool === "TrendLine" ||
              drawingTool === "Path" ||
              selectedDrawingTool === "Rectangle" ||
              selectedDrawingTool === "TrendLine" ||
              selectedDrawingTool === "Path";
            const showLotsControls =
              drawingTool === "LongShortPosition" ||
              selectedDrawingTool === "LongShortPosition";
            return (
              <>
                <div
                  className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 transition-opacity ${
                    showDrawControls ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                  aria-hidden={!showDrawControls}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Draw color
                  </span>
                  <input
                    type="color"
                    aria-label="Rectangle fill color"
                    value={rectangleFillColor}
                    onChange={(event) => setRectangleFillColor(event.target.value)}
                    className="h-5 w-5 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="range"
                    aria-label="Rectangle fill opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rectangleFillOpacity}
                    onChange={(event) => setRectangleFillOpacity(Number(event.target.value))}
                    className="h-2 w-20 accent-foreground"
                  />
                </div>
                <div
                  className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 transition-opacity ${
                    showLotsControls ? "opacity-100" : "pointer-events-none opacity-0"
                  }`}
                  aria-hidden={!showLotsControls}
                >
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Lots
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step={0.01}
                    value={Number.isFinite(longShortLots) ? longShortLots : 1}
                    onChange={(event) => setLongShortLots(Number(event.target.value))}
                    className="h-6 w-20 rounded border border-border bg-background px-2 text-[11px] text-foreground"
                  />
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        /* Compact mode: drawing tools in a popover */
        <div className="relative" ref={compactDrawRef}>
          <button
            type="button"
            onClick={() => { setCompactDrawOpen((o) => !o); setCompactActionsOpen(false); }}
            disabled={!selection}
            className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
              compactDrawOpen || drawingTool
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title="Drawing tools"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {compactDrawOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 rounded-md border border-border bg-popover p-2 shadow-xl">
              <div className="flex flex-col gap-1">
                {DRAW_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => {
                      setDrawingTool((current) => current === tool.id ? null : tool.id);
                      setCompactDrawOpen(false);
                    }}
                    className={`rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors ${
                      drawingTool === tool.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted"
                    }`}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color / lots controls — always visible when active, in both compact and non-compact */}
      {compact && (() => {
        const showDrawControls =
          drawingTool === "Rectangle" ||
          drawingTool === "TrendLine" ||
          drawingTool === "Path" ||
          selectedDrawingTool === "Rectangle" ||
          selectedDrawingTool === "TrendLine" ||
          selectedDrawingTool === "Path";
        const showLotsControls =
          drawingTool === "LongShortPosition" ||
          selectedDrawingTool === "LongShortPosition";
        return (
          <>
            {showDrawControls && (
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-0.5">
                <input
                  type="color"
                  aria-label="Draw color"
                  value={rectangleFillColor}
                  onChange={(event) => setRectangleFillColor(event.target.value)}
                  className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                />
                <input
                  type="range"
                  aria-label="Draw opacity"
                  min={0}
                  max={1}
                  step={0.05}
                  value={rectangleFillOpacity}
                  onChange={(event) => setRectangleFillOpacity(Number(event.target.value))}
                  className="h-2 w-14 accent-foreground"
                />
              </div>
            )}
            {showLotsControls && (
              <div className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <span className="text-[9px] font-medium uppercase text-muted-foreground">Lots</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.01}
                  value={Number.isFinite(longShortLots) ? longShortLots : 1}
                  onChange={(event) => setLongShortLots(Number(event.target.value))}
                  className="h-5 w-16 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                />
              </div>
            )}
          </>
        );
      })()}

      {!compact ? (
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            title={isExpanded ? "Exit full screen" : "Full screen"}
          >
            {isExpanded ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => chartRef.current?.fitContent()}
            disabled={!selection}
            className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
          >
            Fit
          </button>
          <button
            type="button"
            onClick={() => {
              chartRef.current?.removeAllDrawingTools();
              setDrawingTool(null);
              setSelectedDrawingTool(null);
            }}
            disabled={!selection}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            title="Clear drawings"
          >
            <Eraser className="h-3.5 w-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={!selection || isLoading}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      ) : (
        /* Compact mode: actions in a popover */
        <div className="relative ml-auto" ref={compactActionsRef}>
          <button
            type="button"
            onClick={() => { setCompactActionsOpen((o) => !o); setCompactDrawOpen(false); }}
            className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
              compactActionsOpen
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title="More actions"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {compactActionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-xl">
              <button
                type="button"
                onClick={() => { setIsExpanded((prev) => !prev); setCompactActionsOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent"
              >
                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                {isExpanded ? "Exit Full Screen" : "Full Screen"}
              </button>
              <button
                type="button"
                onClick={() => { chartRef.current?.fitContent(); setCompactActionsOpen(false); }}
                disabled={!selection}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Maximize2 className="h-3 w-3" />
                Fit
              </button>
              <button
                type="button"
                onClick={() => { chartRef.current?.removeAllDrawingTools(); setDrawingTool(null); setSelectedDrawingTool(null); setCompactActionsOpen(false); }}
                disabled={!selection}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                <Eraser className="h-3 w-3" />
                Clear
              </button>
              <button
                type="button"
                onClick={() => { refetch(); setCompactActionsOpen(false); }}
                disabled={!selection || isLoading}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  const chartContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      {toolbar}
      {!hasSymbols && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
          No local symbols found. Sync chart data in settings to populate the dropdown.
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          Failed to load chart data: {error.message}
        </div>
      )}

      <div ref={chartAreaRef} className="mt-3 min-h-[420px] flex-1">
        <TradeCandlestickChart
          ref={chartRef}
          data={data}
          height={isExpanded ? expandedHeight : chartAreaHeight}
          isLoading={isLoading}
          drawingTool={drawingTool}
          drawingLineColor={rectangleFillColor}
          rectangleFillColor={drawingFillRgba}
          rectangleBorderColor={rectangleFillColor}
          onDrawingSelectionChange={setSelectedDrawingTool}
          onDrawingToolComplete={() => setDrawingTool(null)}
          longShortLots={longShortLots}
          longShortSymbol={selection?.symbol}
          showRiskReward={false}
          onVisibleRangeChange={handleVisibleRangeChange}
          autoScrollOnData={false}
        />
      </div>
    </div>
  );
  return (
    <>
      <section className="min-w-0 flex-1">
        <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card p-3 text-foreground">
          {!isExpanded && chartContent}
        </div>
      </section>

      {isExpanded && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60"
            onClick={() => setIsExpanded(false)}
            aria-hidden="true"
          />
          <div
            className="fixed inset-4 z-50 flex flex-col rounded-xl border border-border bg-card p-3 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Expanded chart"
            onClick={(e) => e.stopPropagation()}
          >
            {chartContent}
          </div>
        </>
      )}
    </>
  );
}

