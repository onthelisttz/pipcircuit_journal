"use client";

import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Maximize2,
  Minimize2,
  RefreshCw,
  X,
  Pencil,
  MoreVertical,
} from "lucide-react";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { Direction, OrderType } from "@domain/enums";
import { TradeCandlestickChart } from "@ui/components/charts";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import { MT5_HISTORY_ROOT_SETTING_KEY } from "@lib/mt5";
import { useAuth } from "@ui/hooks/useAuth";
import type {
  DrawingToolType,
  TradeCandlestickChartRef,
} from "@ui/components/charts/TradeCandlestickChart";
import { hexToRgba } from "@lib/color";

type TimeframeSummary = {
  timeframe: ChartTimeframe;
  fileName: string;
  barCount: number;
  from: number;
  to: number;
  source?: "cache" | "derived";
};

type SymbolSummary = {
  symbol: string;
  timeframes: TimeframeSummary[];
};

type MetaResponse = {
  sourcePath: string;
  symbols: SymbolSummary[];
  error?: string;
};

type BarsResponse = {
  bars: ChartBar[];
  error?: string;
};

type LoadedRange = {
  from: number;
  to: number;
};

type HistoryChartUpdateMode = "replace" | "append" | "prepend";

const LOAD_LIMIT = 20_000;
const EDGE_FETCH_THRESHOLD = 10;
const FETCH_THROTTLE_MS = 160;
const MAX_RENDERED_BARS: Record<ChartTimeframe, number> = {
  M1: 15_000,
  M5: 30_000,
  M15: 50_000,
  M30: 50_000,
  H1: 80_000,
  H4: 80_000,
  D1: 100_000,
};
const DRAW_TOOLS: { id: DrawingToolType; label: string }[] = [
  { id: "Path", label: "Path" },
  { id: "TrendLine", label: "Trendline" },
  { id: "Rectangle", label: "Rectangle" },
  { id: "LongShortPosition", label: "Long/Short" },
];
const TIMEFRAME_WINDOWS_MS: Record<ChartTimeframe, number> = {
  M1: 3 * 24 * 60 * 60 * 1000,
  M5: 14 * 24 * 60 * 60 * 1000,
  M15: 30 * 24 * 60 * 60 * 1000,
  M30: 90 * 24 * 60 * 60 * 1000,
  H1: 180 * 24 * 60 * 60 * 1000,
  H4: 365 * 24 * 60 * 60 * 1000,
  D1: 5 * 365 * 24 * 60 * 60 * 1000,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromDateInputValue(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function sortTimeframes(timeframes: TimeframeSummary[]): TimeframeSummary[] {
  const order: ChartTimeframe[] = ["M1", "M5", "M15", "H1", "H4", "D1"];
  return [...timeframes].sort(
    (a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe)
  );
}

function normalizeBars(bars: ChartBar[]): ChartBar[] {
  // MT5 API already returns sorted, unique bars — skip expensive sort+dedup
  return bars;
}

function mergeBars(existing: ChartBar[], incoming: ChartBar[]): ChartBar[] {
  return normalizeBars([...existing, ...incoming]);
}

function appendBars(existing: ChartBar[], incoming: ChartBar[]): ChartBar[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  const existingLastTimestamp = existing[existing.length - 1]?.timestamp ?? Number.NEGATIVE_INFINITY;
  const filteredIncoming = incoming.filter((bar) => bar.timestamp > existingLastTimestamp);
  return filteredIncoming.length > 0 ? existing.concat(filteredIncoming) : existing;
}

function prependBars(existing: ChartBar[], incoming: ChartBar[]): ChartBar[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;

  const existingFirstTimestamp = existing[0]?.timestamp ?? Number.POSITIVE_INFINITY;
  const filteredIncoming = incoming.filter((bar) => bar.timestamp < existingFirstTimestamp);
  return filteredIncoming.length > 0 ? filteredIncoming.concat(existing) : existing;
}

function trimBarsForMode(
  bars: ChartBar[],
  mode: HistoryChartUpdateMode,
  timeframe: ChartTimeframe
): { bars: ChartBar[]; updateMode: HistoryChartUpdateMode } {
  const maxBars = MAX_RENDERED_BARS[timeframe];
  if (bars.length <= maxBars) {
    return { bars, updateMode: mode };
  }

  if (mode === "append") {
    return {
      bars: bars.slice(bars.length - maxBars),
      updateMode: "replace",
    };
  }

  if (mode === "prepend") {
    return {
      bars: bars.slice(0, maxBars),
      updateMode: "replace",
    };
  }

  return {
    bars: bars.slice(Math.max(0, bars.length - maxBars)),
    updateMode: "replace",
  };
}

function buildCenteredRange(
  summary: TimeframeSummary,
  targetTimestamp: number
): LoadedRange {
  const windowSize = TIMEFRAME_WINDOWS_MS[summary.timeframe];
  const clampedTarget = Math.max(summary.from, Math.min(summary.to, targetTimestamp));
  let from = clampedTarget - Math.floor(windowSize / 2);
  let to = clampedTarget + Math.floor(windowSize / 2);

  if (from < summary.from) {
    to = Math.min(summary.to, to + (summary.from - from));
    from = summary.from;
  }

  if (to > summary.to) {
    from = Math.max(summary.from, from - (to - summary.to));
    to = summary.to;
  }

  return { from, to };
}

const PLACEHOLDER_TRADE: Trade = {
  accountId: "",
  symbol: "",
  direction: Direction.Buy,
  orderType: OrderType.Market,
  openTime: new Date(0),
  closeTime: new Date(0),
  openPrice: 0,
  volume: 0,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function buildMonthDays(month: Date): Date[] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days: Date[] = [];
  for (let current = start; current <= end; current = new Date(current.getTime() + 24 * 60 * 60 * 1000)) {
    days.push(current);
  }
  return days;
}

interface SingleDatePopoverProps {
  value: Date;
  min: Date;
  max: Date;
  onClose: () => void;
  onApply: (date: Date) => void;
}

interface Mt5HistoryWorkspaceProps {
  onAvailabilityTextChange?: (text: string | null) => void;
  initialSymbol?: string;
  onSymbolChange?: (symbol: string) => void;
  onTimeframeChange?: (timeframe: string) => void;
  /** Hide drawing tools & action buttons for compact multi-pane layouts */
  compact?: boolean;
}

function SingleDatePopover({
  value,
  min,
  max,
  onClose,
  onApply,
}: SingleDatePopoverProps) {
  const [tempDate, setTempDate] = useState<Date>(value);
  const [visibleMonth, setVisibleMonth] = useState<Date>(startOfMonth(value));
  const [isApplyEnabled, setIsApplyEnabled] = useState(true);

  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const firstWeekday = new Date(visibleMonth).getDay();
  const minMonth = startOfMonth(min);
  const maxMonth = startOfMonth(max);
  const canGoPrev = visibleMonth.getTime() > minMonth.getTime();
  const canGoNext = visibleMonth.getTime() < maxMonth.getTime();
  const today = new Date();

  return (
    <div className="fixed inset-x-2 bottom-2 top-16 z-30 overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95 sm:absolute sm:inset-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[320px] sm:max-w-[calc(100vw-2rem)] sm:p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">
          {format(tempDate, "MMM d, yyyy")}
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={onClose}
          aria-label="Close date picker"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => {
            setVisibleMonth((prev) => addMonths(prev, -1));
            setIsApplyEnabled(false);
          }}
          disabled={!canGoPrev}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2">
          <select
            value={visibleMonth.getMonth()}
            onChange={(event) => {
              setVisibleMonth(
                new Date(visibleMonth.getFullYear(), Number(event.target.value), 1)
              );
              setIsApplyEnabled(false);
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            aria-label="Select month"
          >
            {MONTH_NAMES.map((monthName, index) => (
              <option key={monthName} value={index}>
                {monthName}
              </option>
            ))}
          </select>
          <select
            value={visibleMonth.getFullYear()}
            onChange={(event) => {
              setVisibleMonth(
                new Date(Number(event.target.value), visibleMonth.getMonth(), 1)
              );
              setIsApplyEnabled(false);
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
            aria-label="Select year"
          >
            {Array.from(
              { length: max.getFullYear() - min.getFullYear() + 1 },
              (_, index) => max.getFullYear() - index
            ).map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => {
            setVisibleMonth((prev) => addMonths(prev, 1));
            setIsApplyEnabled(false);
          }}
          disabled={!canGoNext}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1 text-[10px] text-muted-foreground">
        <span>S</span>
        <span>M</span>
        <span>T</span>
        <span>W</span>
        <span>T</span>
        <span>F</span>
        <span>S</span>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: firstWeekday }).map((_, index) => (
          <span key={`blank-${index}`} />
        ))}
        {monthDays.map((day) => {
          const isDisabled =
            day.getTime() < min.getTime() || day.getTime() > max.getTime();
          const isSelected = isSameDay(day, tempDate);
          const isToday = isSameDay(day, today);

          return (
            <button
              key={day.toISOString()}
              type="button"
              disabled={isDisabled}
              onClick={() => {
                setTempDate(day);
                setIsApplyEnabled(true);
              }}
              className={[
                "h-8 w-8 rounded-full text-xs transition-colors",
                isSelected
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "hover:bg-accent/60",
                isDisabled ? "cursor-not-allowed opacity-35 hover:bg-transparent" : "",
                isToday ? "ring-1 ring-primary/70 ring-offset-1 ring-offset-popover" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!isApplyEnabled}
          onClick={() => onApply(tempDate)}
          className="rounded-lg bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

export function Mt5HistoryWorkspace({
  onAvailabilityTextChange,
  initialSymbol,
  onSymbolChange,
  onTimeframeChange,
  compact = false,
}: Mt5HistoryWorkspaceProps) {
  const { user } = useAuth();
  const chartRef = useRef<TradeCandlestickChartRef | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const loadedRangeRef = useRef<LoadedRange | null>(null);
  const requestedRangeRef = useRef<LoadedRange | null>(null);
  const activeSeriesKeyRef = useRef("");
  const loadGenerationRef = useRef(0);
  const suppressEdgeLoadingUntilRef = useRef(0);
  const shouldCenterOnNextDataRef = useRef(false);
  const fetchingPrevRef = useRef(false);
  const fetchingNextRef = useRef(false);
  const pendingPrevFetchRef = useRef(false);
  const pendingNextFetchRef = useRef(false);
  const lastPrevFetchRef = useRef(0);
  const lastNextFetchRef = useRef(0);
  const lastVisibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const lastRequestedPrevRangeKeyRef = useRef("");
  const lastRequestedNextRangeKeyRef = useRef("");

  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [historyRootPath, setHistoryRootPath] = useState("");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isMetaLoading, setIsMetaLoading] = useState(true);

  const [symbol, setSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("M1");
  const [goToDate, setGoToDate] = useState("");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [focusTimestamp, setFocusTimestamp] = useState<number | null>(null);
  const [chartInstanceKey, setChartInstanceKey] = useState(0);
  const [chartUpdateMode, setChartUpdateMode] = useState<HistoryChartUpdateMode>("replace");
  const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
  const [rectangleFillColor, setRectangleFillColor] = useState("#8b5cf6");
  const [rectangleFillOpacity, setRectangleFillOpacity] = useState(0.2);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState<DrawingToolType | null>(null);
  const [longShortLots, setLongShortLots] = useState(1);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(640);
  const [chartAreaHeight, setChartAreaHeight] = useState(520);
  const [compactDrawOpen, setCompactDrawOpen] = useState(false);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const compactDrawRef = useRef<HTMLDivElement>(null);
  const compactActionsRef = useRef<HTMLDivElement>(null);

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [isBarsLoading, setIsBarsLoading] = useState(false);
  const [isEdgeLoading, setIsEdgeLoading] = useState(false);

  const selectedSymbol = useMemo(
    () => meta?.symbols.find((item) => item.symbol === symbol) ?? null,
    [meta, symbol]
  );

  const availableTimeframes = useMemo(
    () => sortTimeframes(selectedSymbol?.timeframes ?? []),
    [selectedSymbol]
  );

  const selectedTimeframe = useMemo(
    () => availableTimeframes.find((item) => item.timeframe === timeframe) ?? null,
    [availableTimeframes, timeframe]
  );
  const drawingFillRgba = useMemo(
    () => hexToRgba(rectangleFillColor, rectangleFillOpacity),
    [rectangleFillColor, rectangleFillOpacity]
  );

  const activeSeriesKey = `${symbol}|${selectedTimeframe?.timeframe ?? ""}`;

  useEffect(() => {
    let cancelled = false;

    const loadRootPath = async () => {
      try {
        const repo = createSettingsRepository(user?.id);
        const record = await repo.get(MT5_HISTORY_ROOT_SETTING_KEY);
        if (cancelled) return;
        setHistoryRootPath(typeof record?.value === "string" ? record.value.trim() : "");
      } catch {
        if (!cancelled) {
          setHistoryRootPath("");
        }
      }
    };

    void loadRootPath();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const viewerTrade = useMemo<Trade>(() => {
    if (!symbol || focusTimestamp == null) return PLACEHOLDER_TRADE;
    const at = new Date(focusTimestamp);
    return {
      accountId: "",
      symbol,
      direction: Direction.Buy,
      orderType: OrderType.Market,
      openTime: at,
      closeTime: at,
      openPrice: 0,
      volume: 0,
      createdAt: at,
      updatedAt: at,
    };
  }, [focusTimestamp, symbol]);

  useEffect(() => {
    loadedRangeRef.current = loadedRange;
  }, [loadedRange]);

  useEffect(() => {
    barsRef.current = bars;
  }, [bars]);

  useEffect(() => {
    activeSeriesKeyRef.current = activeSeriesKey;
    loadGenerationRef.current += 1;
    fetchingPrevRef.current = false;
    fetchingNextRef.current = false;
    pendingPrevFetchRef.current = false;
    pendingNextFetchRef.current = false;
    requestedRangeRef.current = null;
    lastRequestedPrevRangeKeyRef.current = "";
    lastRequestedNextRangeKeyRef.current = "";
    lastPrevFetchRef.current = 0;
    lastNextFetchRef.current = 0;
    lastVisibleRangeRef.current = null;
  }, [activeSeriesKey]);

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
      const toggleTool = (toolId: DrawingToolType) => {
        setDrawingTool((current) => (current === toolId ? null : toolId));
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

  useEffect(() => {
    if (!isDatePickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!datePickerRef.current?.contains(target)) {
        setIsDatePickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDatePickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isDatePickerOpen]);

  useEffect(() => {
    let cancelled = false;

    const loadMeta = async () => {
      setIsMetaLoading(true);
      setMetaError(null);
      try {
        const params = new URLSearchParams();
        if (historyRootPath) {
          params.set("rootPath", historyRootPath);
        }
        const response = await fetch(
          `/api/mt5/history/meta${params.toString() ? `?${params.toString()}` : ""}`,
          { cache: "no-store" }
        );
        const data = (await response.json()) as MetaResponse;
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load MT5 history metadata.");
        }
        if (cancelled) return;

        setMeta(data);

        const firstSymbol = data.symbols[0];
        const firstTimeframe = firstSymbol ? sortTimeframes(firstSymbol.timeframes)[0] : null;
        if (firstSymbol && firstTimeframe) {
          const sym = initialSymbol && data.symbols.some((s) => s.symbol === initialSymbol)
            ? initialSymbol
            : firstSymbol.symbol;
          setSymbol(sym);
          setTimeframe(firstTimeframe.timeframe);
        }
      } catch (error) {
        if (!cancelled) {
          setMetaError(
            error instanceof Error ? error.message : "Failed to load MT5 metadata."
          );
        }
      } finally {
        if (!cancelled) {
          setIsMetaLoading(false);
        }
      }
    };

    void loadMeta();

    return () => {
      cancelled = true;
    };
  }, [historyRootPath]);

  useEffect(() => {
    if (!selectedSymbol) return;
    if (availableTimeframes.length === 0) return;
    if (availableTimeframes.some((item) => item.timeframe === timeframe)) return;
    setTimeframe(availableTimeframes[0].timeframe);
  }, [availableTimeframes, selectedSymbol, timeframe]);

  // Report values to parent so tab labels are correct
  useEffect(() => {
    if (symbol) onSymbolChange?.(symbol);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    if (timeframe) onTimeframeChange?.(timeframe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const requestBars = useCallback(
    async (range: LoadedRange): Promise<ChartBar[]> => {
      if (!symbol || !selectedTimeframe) return [];

      const params = new URLSearchParams({
        symbol,
        timeframe: selectedTimeframe.timeframe,
        from: String(range.from),
        to: String(range.to),
        limit: String(LOAD_LIMIT),
      });
      if (historyRootPath) {
        params.set("rootPath", historyRootPath);
      }

      const response = await fetch(`/api/mt5/history/bars?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as BarsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load MT5 bars.");
      }
      return payload.bars;
    },
    [historyRootPath, selectedTimeframe, symbol]
  );

  const loadWindow = useCallback(
    async (range: LoadedRange, mode: "replace" | "prepend" | "append") => {
      if (!symbol || !selectedTimeframe) return;

      if (mode === "replace") {
        loadGenerationRef.current += 1;
        suppressEdgeLoadingUntilRef.current = Date.now() + 450;
        fetchingPrevRef.current = false;
        fetchingNextRef.current = false;
        pendingPrevFetchRef.current = false;
        pendingNextFetchRef.current = false;
        lastRequestedPrevRangeKeyRef.current = "";
        lastRequestedNextRangeKeyRef.current = "";
        lastPrevFetchRef.current = 0;
        lastNextFetchRef.current = 0;
        lastVisibleRangeRef.current = null;
        loadedRangeRef.current = null;
        requestedRangeRef.current = null;
        setLoadedRange(null);
        setBars([]);
        setChartUpdateMode("replace");
        setChartInstanceKey((current) => current + 1);
      }

      const requestKey = activeSeriesKeyRef.current;
      const generation = loadGenerationRef.current;
      if (mode === "replace") {
        setIsBarsLoading(true);
      } else {
        setIsEdgeLoading(true);
      }
      setBarsError(null);
      try {
        const nextBars = await requestBars(range);
        if (
          activeSeriesKeyRef.current !== requestKey ||
          loadGenerationRef.current !== generation
        ) {
          return;
        }
        const normalizedIncoming = normalizeBars(nextBars);
        const previousBars = barsRef.current;
        const mergedBars =
          mode === "replace"
            ? normalizedIncoming
            : mode === "append"
              ? appendBars(previousBars, normalizedIncoming)
              : mode === "prepend"
                ? prependBars(previousBars, normalizedIncoming)
                : mergeBars(previousBars, normalizedIncoming);
        const { bars: nextDisplayBars, updateMode } = trimBarsForMode(
          mergedBars,
          mode,
          selectedTimeframe.timeframe
        );
        const nextDisplayedRange =
          nextDisplayBars.length > 0
            ? {
                from: nextDisplayBars[0].timestamp,
                to: nextDisplayBars[nextDisplayBars.length - 1].timestamp,
              }
            : null;

        barsRef.current = nextDisplayBars;
        setChartUpdateMode(updateMode);
        setBars(nextDisplayBars);
        loadedRangeRef.current = nextDisplayedRange;
        if (mode === "replace") {
          requestedRangeRef.current = nextDisplayedRange;
        }
        setLoadedRange(nextDisplayedRange);

        if (mode === "replace" && normalizedIncoming.length === 0) {
          setBarsError("No bars found for that date.");
        }
      } catch (error) {
        if (
          activeSeriesKeyRef.current !== requestKey ||
          loadGenerationRef.current !== generation
        ) {
          return;
        }
        if (mode === "replace") {
          setBars([]);
          setLoadedRange(null);
        }
        setBarsError(error instanceof Error ? error.message : "Failed to load MT5 bars.");
      } finally {
        if (
          activeSeriesKeyRef.current === requestKey &&
          loadGenerationRef.current === generation
        ) {
          if (mode === "replace") {
            setIsBarsLoading(false);
          } else {
            setIsEdgeLoading(false);
          }
        }
      }
    },
    [requestBars, selectedTimeframe, symbol]
  );

  const goToTimestamp = useCallback(
    async (targetTimestamp: number) => {
      if (!selectedTimeframe || !symbol) return;
      const range = buildCenteredRange(selectedTimeframe, targetTimestamp);
      const clampedTarget = Math.max(
        selectedTimeframe.from,
        Math.min(selectedTimeframe.to, targetTimestamp)
      );

      shouldCenterOnNextDataRef.current = true;
      setFocusTimestamp(clampedTarget);
      setGoToDate(toDateInputValue(clampedTarget));
      await loadWindow(range, "replace");
    },
    [loadWindow, selectedTimeframe, symbol]
  );

  useEffect(() => {
    if (!selectedTimeframe || !symbol) return;
    void goToTimestamp(selectedTimeframe.to);
  }, [goToTimestamp, selectedTimeframe, symbol]);

  useEffect(() => {
    if (!shouldCenterOnNextDataRef.current || bars.length === 0) return;
    shouldCenterOnNextDataRef.current = false;
    window.setTimeout(() => {
      chartRef.current?.fitContent();
      lastVisibleRangeRef.current = null;
      suppressEdgeLoadingUntilRef.current = Date.now() + 220;
    }, 80);
  }, [bars]);

  const fetchPrevious = useCallback(async () => {
    if (!selectedTimeframe || fetchingPrevRef.current) return;

    const currentRange = requestedRangeRef.current ?? loadedRangeRef.current;
    if (!currentRange || currentRange.from <= selectedTimeframe.from) return;

    const requestRange: LoadedRange = {
      from: Math.max(
        selectedTimeframe.from,
        currentRange.from - TIMEFRAME_WINDOWS_MS[selectedTimeframe.timeframe]
      ),
      to: currentRange.from - 1,
    };

    if (requestRange.to < requestRange.from) return;

    const requestKey = `${requestRange.from}:${requestRange.to}`;
    if (requestKey === lastRequestedPrevRangeKeyRef.current) return;
    lastRequestedPrevRangeKeyRef.current = requestKey;

    requestedRangeRef.current = {
      from: requestRange.from,
      to: currentRange.to,
    };

    fetchingPrevRef.current = true;
    try {
      await loadWindow(requestRange, "prepend");
    } finally {
      lastRequestedPrevRangeKeyRef.current = "";
      fetchingPrevRef.current = false;
      setTimeout(() => {
        if (pendingPrevFetchRef.current && !fetchingPrevRef.current) {
          pendingPrevFetchRef.current = false;
          void fetchPrevious();
        }
      }, 80);
    }
  }, [loadWindow, selectedTimeframe]);

  const fetchNext = useCallback(async () => {
    if (!selectedTimeframe || fetchingNextRef.current) return;

    const currentRange = requestedRangeRef.current ?? loadedRangeRef.current;
    if (!currentRange || currentRange.to >= selectedTimeframe.to) return;

    const requestRange: LoadedRange = {
      from: currentRange.to + 1,
      to: Math.min(
        selectedTimeframe.to,
        currentRange.to + TIMEFRAME_WINDOWS_MS[selectedTimeframe.timeframe]
      ),
    };

    if (requestRange.to < requestRange.from) return;

    const requestKey = `${requestRange.from}:${requestRange.to}`;
    if (requestKey === lastRequestedNextRangeKeyRef.current) return;
    lastRequestedNextRangeKeyRef.current = requestKey;

    requestedRangeRef.current = {
      from: currentRange.from,
      to: requestRange.to,
    };

    fetchingNextRef.current = true;
    try {
      await loadWindow(requestRange, "append");
    } finally {
      lastRequestedNextRangeKeyRef.current = "";
      fetchingNextRef.current = false;
      setTimeout(() => {
        if (pendingNextFetchRef.current && !fetchingNextRef.current) {
          pendingNextFetchRef.current = false;
          void fetchNext();
        }
      }, 80);
    }
  }, [loadWindow, selectedTimeframe]);

  const handleVisibleRangeChange = useCallback(
    (from: number, to: number) => {
      const currentBarsLength = barsRef.current.length;
      if (currentBarsLength === 0) return;
      if (Date.now() < suppressEdgeLoadingUntilRef.current) return;

      const previousRange = lastVisibleRangeRef.current;
      const currentCenter = (from + to) / 2;
      const previousCenter = previousRange ? (previousRange.from + previousRange.to) / 2 : currentCenter;
      const panDirection = Math.sign(currentCenter - previousCenter);
      lastVisibleRangeRef.current = { from, to };

      const leftIndex = Math.floor(from);
      const rightIndex = Math.ceil(to);
      const nearLeft = leftIndex <= EDGE_FETCH_THRESHOLD;
      const nearRight = rightIndex >= currentBarsLength - EDGE_FETCH_THRESHOLD;

      let shouldFetchPrev = nearLeft;
      let shouldFetchNext = nearRight;

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

      if (shouldFetchPrev) {
        const now = Date.now();
        if (fetchingPrevRef.current) {
          pendingPrevFetchRef.current = true;
        } else if (now - lastPrevFetchRef.current >= FETCH_THROTTLE_MS) {
          lastPrevFetchRef.current = now;
          void fetchPrevious();
        }
      }

      if (shouldFetchNext) {
        const now = Date.now();
        if (fetchingNextRef.current) {
          pendingNextFetchRef.current = true;
        } else if (now - lastNextFetchRef.current >= FETCH_THROTTLE_MS) {
          lastNextFetchRef.current = now;
          void fetchNext();
        }
      }
    },
    [fetchNext, fetchPrevious]
  );

  const applyGoToDate = useCallback(
    (date: Date) => {
      const targetTimestamp = fromDateInputValue(toDateInputValue(date.getTime()));
      if (!Number.isFinite(targetTimestamp)) return;
      setGoToDate(toDateInputValue(targetTimestamp));
      setIsDatePickerOpen(false);
      void goToTimestamp(targetTimestamp);
    },
    [goToTimestamp]
  );

  const refreshCurrentView = useCallback(() => {
    if (!selectedTimeframe) return;
    const target = focusTimestamp ?? selectedTimeframe.to;
    void goToTimestamp(target);
  }, [focusTimestamp, goToTimestamp, selectedTimeframe]);

  /* Pending-fetch retry is now handled via queueMicrotask inside fetchPrevious/fetchNext */

  useEffect(() => {
    if (!onAvailabilityTextChange) return;
    if (!selectedTimeframe) {
      onAvailabilityTextChange(null);
      return;
    }
    onAvailabilityTextChange(
      `Available: ${formatShortDate(selectedTimeframe.from)} to ${formatShortDate(selectedTimeframe.to)}`
    );
  }, [onAvailabilityTextChange, selectedTimeframe]);

  useEffect(() => {
    return () => {
      onAvailabilityTextChange?.(null);
    };
  }, [onAvailabilityTextChange]);

  const toolbar = (
    <div className={`relative z-20 flex flex-wrap items-center gap-2 border-b border-border ${compact ? 'pb-1.5' : 'pb-3'}`}>
      <select
        value={symbol}
        onChange={(event) => {
          setSymbol(event.target.value);
          onSymbolChange?.(event.target.value);
        }}
        disabled={isMetaLoading || !meta?.symbols.length}
        className="h-7 min-w-[120px] rounded border border-border bg-background px-2 text-xs font-medium text-foreground"
      >
        {meta?.symbols.map((item) => (
          <option key={item.symbol} value={item.symbol}>
            {item.symbol}
          </option>
        ))}
      </select>

      <select
        value={timeframe}
        onChange={(event) => {
          const tf = event.target.value as ChartTimeframe;
          setTimeframe(tf);
          onTimeframeChange?.(tf);
        }}
        disabled={!availableTimeframes.length}
        className="h-7 min-w-[84px] rounded border border-border bg-background px-2 text-xs font-medium text-foreground"
      >
        {availableTimeframes.map((item) => (
          <option key={item.timeframe} value={item.timeframe}>
            {item.timeframe}
          </option>
        ))}
      </select>

      <div className="relative" ref={datePickerRef}>
        <button
          type="button"
          onClick={() => setIsDatePickerOpen((current) => !current)}
          disabled={!selectedTimeframe || !goToDate}
          className="flex h-7 items-center gap-2 rounded border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-60"
        >
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{goToDate ? format(new Date(`${goToDate}T00:00:00`), "MMM d, yyyy") : "Select date"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {isDatePickerOpen && selectedTimeframe && goToDate && (
          <SingleDatePopover
            key={goToDate}
            value={new Date(`${goToDate}T00:00:00`)}
            min={new Date(selectedTimeframe.from)}
            max={new Date(selectedTimeframe.to)}
            onClose={() => setIsDatePickerOpen(false)}
            onApply={applyGoToDate}
          />
        )}
      </div>

      {!compact ? (
        <div className="flex flex-wrap items-center gap-2">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setDrawingTool((current) => current === tool.id ? null : tool.id)}
              disabled={!selectedTimeframe}
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
            const showDrawControls = drawingTool === "Rectangle" || drawingTool === "TrendLine" || drawingTool === "Path" || selectedDrawingTool === "Rectangle" || selectedDrawingTool === "TrendLine" || selectedDrawingTool === "Path";
            const showLotsControls = drawingTool === "LongShortPosition" || selectedDrawingTool === "LongShortPosition";
            return (
              <>
                <div className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 transition-opacity ${showDrawControls ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-hidden={!showDrawControls}>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Draw color</span>
                  <input type="color" aria-label="Draw color" value={rectangleFillColor} onChange={(event) => setRectangleFillColor(event.target.value)} className="h-5 w-5 cursor-pointer rounded border border-border bg-transparent p-0" />
                  <input type="range" aria-label="Draw opacity" min={0} max={1} step={0.05} value={rectangleFillOpacity} onChange={(event) => setRectangleFillOpacity(Number(event.target.value))} className="h-2 w-20 accent-foreground" />
                </div>
                <div className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 transition-opacity ${showLotsControls ? "opacity-100" : "pointer-events-none opacity-0"}`} aria-hidden={!showLotsControls}>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Lots</span>
                  <input type="number" inputMode="decimal" min={0.01} step={0.01} value={Number.isFinite(longShortLots) ? longShortLots : 1} onChange={(event) => setLongShortLots(Number(event.target.value))} className="h-6 w-20 rounded border border-border bg-background px-2 text-[11px] text-foreground" />
                </div>
              </>
            );
          })()}
        </div>
      ) : (
        <div className="relative" ref={compactDrawRef}>
          <button
            type="button"
            onClick={() => { setCompactDrawOpen((o) => !o); setCompactActionsOpen(false); }}
            disabled={!selectedTimeframe}
            className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
              compactDrawOpen || drawingTool ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title="Drawing tools"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {compactDrawOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 rounded-md border border-border bg-popover p-2 shadow-xl">
              <div className="flex flex-col gap-1">
                {DRAW_TOOLS.map((tool) => (
                  <button key={tool.id} type="button" onClick={() => { setDrawingTool((current) => current === tool.id ? null : tool.id); setCompactDrawOpen(false); }} className={`rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors ${drawingTool === tool.id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted"}`}>
                    {tool.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {compact && (() => {
        const showDrawControls = drawingTool === "Rectangle" || drawingTool === "TrendLine" || drawingTool === "Path" || selectedDrawingTool === "Rectangle" || selectedDrawingTool === "TrendLine" || selectedDrawingTool === "Path";
        const showLotsControls = drawingTool === "LongShortPosition" || selectedDrawingTool === "LongShortPosition";
        return (
          <>
            {showDrawControls && (
              <div className="flex items-center gap-2 rounded-md border border-border px-2 py-0.5">
                <input type="color" aria-label="Draw color" value={rectangleFillColor} onChange={(event) => setRectangleFillColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" />
                <input type="range" aria-label="Draw opacity" min={0} max={1} step={0.05} value={rectangleFillOpacity} onChange={(event) => setRectangleFillOpacity(Number(event.target.value))} className="h-2 w-14 accent-foreground" />
              </div>
            )}
            {showLotsControls && (
              <div className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <span className="text-[9px] font-medium uppercase text-muted-foreground">Lots</span>
                <input type="number" inputMode="decimal" min={0.01} step={0.01} value={Number.isFinite(longShortLots) ? longShortLots : 1} onChange={(event) => setLongShortLots(Number(event.target.value))} className="h-5 w-16 rounded border border-border bg-background px-1 text-[10px] text-foreground" />
              </div>
            )}
          </>
        );
      })()}

      {!compact ? (
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setIsExpanded((prev) => !prev)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted" title={isExpanded ? "Exit full screen" : "Full screen"}>
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
          <button type="button" onClick={() => chartRef.current?.fitContent()} disabled={!selectedTimeframe} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">Fit</button>
          <button type="button" onClick={() => { chartRef.current?.removeAllDrawingTools(); setDrawingTool(null); setSelectedDrawingTool(null); }} disabled={!selectedTimeframe} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted" title="Clear drawings">
            <Eraser className="h-3.5 w-3.5" /> Clear
          </button>
          <button type="button" onClick={refreshCurrentView} disabled={!selectedTimeframe || isBarsLoading || isEdgeLoading} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${isBarsLoading || isEdgeLoading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      ) : (
        <div className="relative ml-auto" ref={compactActionsRef}>
          <button
            type="button"
            onClick={() => { setCompactActionsOpen((o) => !o); setCompactDrawOpen(false); }}
            className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
              compactActionsOpen ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title="More actions"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {compactActionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[120px] rounded-md border border-border bg-popover py-1 shadow-xl">
              <button type="button" onClick={() => { setIsExpanded((prev) => !prev); setCompactActionsOpen(false); }} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent">
                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
                {isExpanded ? "Exit Full Screen" : "Full Screen"}
              </button>
              <button type="button" onClick={() => { chartRef.current?.fitContent(); setCompactActionsOpen(false); }} disabled={!selectedTimeframe} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50">
                <Maximize2 className="h-3 w-3" /> Fit
              </button>
              <button type="button" onClick={() => { chartRef.current?.removeAllDrawingTools(); setDrawingTool(null); setSelectedDrawingTool(null); setCompactActionsOpen(false); }} disabled={!selectedTimeframe} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50">
                <Eraser className="h-3 w-3" /> Clear
              </button>
              <button type="button" onClick={() => { refreshCurrentView(); setCompactActionsOpen(false); }} disabled={!selectedTimeframe || isBarsLoading || isEdgeLoading} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50">
                <RefreshCw className={`h-3 w-3 ${isBarsLoading || isEdgeLoading ? "animate-spin" : ""}`} /> Refresh
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

      {metaError && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {metaError}
        </div>
      )}

      {barsError && (
        <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {barsError}
        </div>
      )}

      <div ref={chartAreaRef} className="mt-3 min-h-[420px] flex-1">
        <TradeCandlestickChart
          key={chartInstanceKey}
          ref={chartRef}
          data={bars}
          dataUpdateMode={chartUpdateMode}
          trade={viewerTrade}
          height={isExpanded ? expandedHeight : chartAreaHeight}
          isLoading={isBarsLoading}
          drawingTool={drawingTool}
          drawingLineColor={rectangleFillColor}
          rectangleFillColor={drawingFillRgba}
          rectangleBorderColor={rectangleFillColor}
          onDrawingSelectionChange={setSelectedDrawingTool}
          onDrawingToolComplete={() => setDrawingTool(null)}
          longShortLots={longShortLots}
          longShortSymbol={symbol}
          showEntryMarker={false}
          showExitMarker={false}
          showRiskReward={false}
          showRiskRewardLabels={false}
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
            aria-label="Expanded history chart"
            onClick={(e) => e.stopPropagation()}
          >
            {chartContent}
          </div>
        </>
      )}
    </>
  );
}
