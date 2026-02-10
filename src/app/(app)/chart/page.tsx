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
} from "lucide-react";
import type { ChartTimeframe, Trade } from "@domain/entities";
import { Direction, OrderType } from "@domain/enums";
import { TradeCandlestickChart } from "@ui/components/charts";
import type { DrawingToolType, TradeCandlestickChartRef } from "@ui/components/charts/TradeCandlestickChart";
import { useChartData } from "@ui/hooks/useChartData";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { useAuth } from "@ui/hooks/useAuth";
import { useAccount } from "@ui/hooks/useAccount";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { SupabaseSymbolSyncProgressRepository } from "@infrastructure/db/supabase/repositories";
import { DualSymbolSyncProgressRepository } from "@infrastructure/db/DualSymbolSyncProgressRepository";
import { TokenStorage } from "@infrastructure/auth";

const CHART_SELECTION_KEY = "chartSelection";
const CHART_TIMEFRAME_KEY = "chartTimeframe";

const DRAW_TOOLS: { id: DrawingToolType; label: string }[] = [
  { id: "Path", label: "Path" },
  { id: "TrendLine", label: "Trendline" },
  { id: "Rectangle", label: "Rectangle" },
  { id: "LongShortPosition", label: "Long/Short" },
];

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1"];

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

export default function ChartPage() {
  const { user } = useAuth();
  const { activeAccount, accounts } = useAccount();
  const progressRepo = useMemo(() => {
    const dexie = new DexieSymbolSyncProgressRepository();
    return user?.id
      ? new DualSymbolSyncProgressRepository(
          dexie,
          new SupabaseSymbolSyncProgressRepository(user.id)
        )
      : dexie;
  }, [user?.id]);

  const { symbolProgress } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  const [selection, setSelection] = useState<{ broker: string; symbol: string } | null>(null);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("M1");
  const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(640);
  const lastFetchRef = useRef(0);
  const fetchingPrevRef = useRef(false);
  const chartRef = useRef<TradeCandlestickChartRef | null>(null);
  const symbolButtonRef = useRef<HTMLButtonElement>(null);
  const symbolMenuRef = useRef<HTMLDivElement>(null);
  const timeframeButtonRef = useRef<HTMLButtonElement>(null);
  const timeframeMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CHART_SELECTION_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { broker?: string; symbol?: string };
        if (parsed.broker && parsed.symbol) {
          setSelection({ broker: parsed.broker, symbol: parsed.symbol });
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(CHART_TIMEFRAME_KEY);
      if (raw === "M1" || raw === "M5" || raw === "M15" || raw === "H1") {
        setTimeframe(raw);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !selection) return;
    window.localStorage.setItem(CHART_SELECTION_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_TIMEFRAME_KEY, timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (symbolProgress.length === 0) return;
    if (!selection) {
      const first = symbolProgress[0];
      setSelection({ broker: first.broker, symbol: first.symbol });
      return;
    }
    const exists = symbolProgress.some(
      (p) => p.broker === selection.broker && p.symbol === selection.symbol
    );
    if (!exists) {
      const first = symbolProgress[0];
      setSelection({ broker: first.broker, symbol: first.symbol });
    }
  }, [symbolProgress, selection]);

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
  }, [accountForBroker?.accountNumber, selection, selectedProgress?.lastBarDate]);

  const accessToken = useMemo(() => {
    if (!accountForBroker) return undefined;
    return TokenStorage.getGlobal()?.accessToken;
  }, [accountForBroker]);

  const chartEnabled = Boolean(selection && chartTrade);

  const { data, isLoading, error, refetch, fetchPrevious } = useChartData({
    trade: chartTrade ?? PLACEHOLDER_TRADE,
    timeframe,
    accessToken,
    broker: selection?.broker,
    windowDays,
    enabled: chartEnabled,
  });

  const handleVisibleRangeChange = useCallback(
    (from: number, _to: number) => {
      if (!selectedProgress || selectedProgress.status !== "completed") return;
      if (data.length === 0) return;
      if (fetchingPrevRef.current) return;

      const earliest = data[0]?.timestamp ?? null;
      if (selectedProgress.firstBarDate && earliest != null) {
        const firstTs = new Date(selectedProgress.firstBarDate).getTime();
        if (earliest <= firstTs + 60_000) return;
      }

      const leftIndex = Math.floor(from);
      if (leftIndex <= 10) {
        const now = Date.now();
        if (now - lastFetchRef.current < 800) return;
        lastFetchRef.current = now;
        fetchingPrevRef.current = true;
        void fetchPrevious().finally(() => {
          fetchingPrevRef.current = false;
        });
      }
    },
    [data, fetchPrevious, selectedProgress]
  );

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

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
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
                        setSelection({
                          broker: broker.broker,
                          symbol: symbol.symbol,
                        });
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
      </div>
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
    </div>
  );

  const chartContent = (
    <>
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

      <div className="mt-3">
        <TradeCandlestickChart
          ref={chartRef}
          data={data}
          height={isExpanded ? expandedHeight : 520}
          isLoading={isLoading}
          drawingTool={drawingTool}
          showRiskReward={false}
          onVisibleRangeChange={handleVisibleRangeChange}
          autoScrollOnData={false}
        />
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Chart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            TradingView-style workspace for your synced symbols.
          </p>
        </div>
      </div>

      <section className="min-w-0 flex-1">
        <div className="rounded-xl border border-border bg-card p-3 text-foreground">
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
    </div>
  );
}



