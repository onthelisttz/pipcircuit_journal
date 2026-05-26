"use client";

import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Eraser,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
  X,
  Pencil,
  MoreVertical,
} from "lucide-react";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { Direction, OrderType } from "@domain/enums";
import { TradeCandlestickChart } from "@ui/components/charts";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import {
  buildMt5ServiceEndpoint,
  DEFAULT_MT5_LOCAL_SERVICE_URL,
  MT5_HISTORY_ROOT_SETTING_KEY,
  MT5_LOCAL_SERVICE_URL_SETTING_KEY,
  normalizeMt5ServiceUrl,
} from "@lib/mt5";
import { useAuth } from "@ui/hooks/useAuth";
import type {
  DrawingToolType,
  TradeCandlestickChartRef,
} from "@ui/components/charts/TradeCandlestickChart";
type DrawingToolExport = ReturnType<TradeCandlestickChartRef["exportAllDrawings"]>[number];
import { hexToRgba } from "@lib/color";
import { TimeGuidesControls } from "./TimeGuidesControls";
import {
  readStoredTimeGuideSettings,
  type TimeGuideSettings,
} from "./timeGuides";
import type {
  ChartObservationLoadRequest,
  ChartObservationWorkspaceApi,
} from "./chartObservationTypes";
import {
  drawingTimestampToMs,
  filterDrawingsToVisibleWindow,
} from "./chartObservationUtils";
import {
  clampReplayIndex,
  DEFAULT_REPLAY_INTERVAL_MS,
  findReplayStartIndex,
  findNearestReplayIndex,
  REPLAY_SPEED_OPTIONS,
} from "./replay";

type TimeframeSummary = {
  timeframe: ChartTimeframe;
  fileName: string;
  barCount: number;
  from: number;
  to: number;
  source?: "cache" | "derived" | "live";
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
type ReplayStartMode = "bar" | "date";

const LOAD_LIMIT = 20_000;
const EDGE_FETCH_THRESHOLD = 10;
const FETCH_THROTTLE_MS = 160;
const REPLAY_RIGHT_OFFSET_BARS = 12;
const HISTORY_TIME_GUIDES_KEY = "chartTimeGuides_history";
const CHART_CONTINUOUS_DRAWING_KEY = "chartContinuousDrawingEnabled_v1";
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
  { id: "Brush", label: "Brush" },
  { id: "Path", label: "Path" },
  { id: "Gan", label: "Gan" },
  { id: "TrendLine", label: "Trendline" },
  { id: "HorizontalRay", label: "H-Ray" },
  { id: "Rectangle", label: "Rectangle" },
  { id: "Callout", label: "Text" },
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

function DrawingToolGlyph({ tool }: { tool: DrawingToolType }) {
  switch (tool) {
    case "Brush":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 10.5c1.5-3 3-5 5.5-5 2 0 2.5 1 4 1 1 0 1.5-.5 1.5-.5" />
          <path d="M2.5 12c1.5-1 2.5-1 4-.5" />
        </svg>
      );
    case "Path":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 11.5 5.5 8l2.5 2.5L14 4.5" />
          <circle cx="2" cy="11.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="14" cy="4.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "TrendLine":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 12.5 13 4" />
        </svg>
      );
    case "Gan":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M3 5h10" />
          <path d="M3 8h10" />
          <path d="M3 11h10" />
        </svg>
      );
    case "HorizontalRay":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 8h10" />
          <path d="m10.5 5.5 2.5 2.5-2.5 2.5" />
        </svg>
      );
    case "Rectangle":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3" y="4" width="10" height="8" rx="1" />
        </svg>
      );
    case "Callout":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4.5h10v6H8l-2.5 2v-2H3z" />
        </svg>
      );
    case "LongShortPosition":
      return (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 12V4" />
          <path d="m3.5 5.5 1.5-1.5 1.5 1.5" />
          <path d="M11 4v8" />
          <path d="m9.5 10.5 1.5 1.5 1.5-1.5" />
        </svg>
      );
    default:
      return <Pencil className="h-3.5 w-3.5" />;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toDateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateInputValue(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const parsed = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return null;
  if (toDateInputValue(parsed.getTime()) !== value) return null;

  return parsed;
}

function fromDateInputValue(value: string): number {
  return parseDateInputValue(value)?.getTime() ?? Number.NaN;
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
  const order: ChartTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
  return [...timeframes].sort(
    (a, b) => order.indexOf(a.timeframe) - order.indexOf(b.timeframe)
  );
}

function resolvePreferredSelection(
  symbols: SymbolSummary[],
  preferredSymbol: string,
  preferredTimeframe: ChartTimeframe,
  initialSymbol?: string
): { symbol: string; timeframe: ChartTimeframe; summary: TimeframeSummary } | null {
  const initialCandidate =
    initialSymbol && symbols.some((item) => item.symbol === initialSymbol)
      ? initialSymbol
      : "";
  const symbolCandidate =
    preferredSymbol && symbols.some((item) => item.symbol === preferredSymbol)
      ? preferredSymbol
      : initialCandidate;
  const resolvedSymbol = symbolCandidate || symbols[0]?.symbol || "";
  const symbolEntry = symbols.find((item) => item.symbol === resolvedSymbol);
  if (!symbolEntry) return null;

  const sortedTimeframes = sortTimeframes(symbolEntry.timeframes);
  const summary =
    sortedTimeframes.find((item) => item.timeframe === preferredTimeframe) ??
    sortedTimeframes[0];
  if (!summary) return null;

  return {
    symbol: resolvedSymbol,
    timeframe: summary.timeframe,
    summary,
  };
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

function getDrawingTimeBounds(drawings: DrawingToolExport[]): LoadedRange | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const drawing of drawings) {
    for (const point of drawing.points) {
      if (!Number.isFinite(point.timestamp)) continue;
      const timestamp = drawingTimestampToMs(point.timestamp);
      min = Math.min(min, timestamp);
      max = Math.max(max, timestamp);
    }
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { from: min, to: max };
}

function extendRangeToIncludeDrawings(
  range: LoadedRange,
  summary: TimeframeSummary,
  drawings: DrawingToolExport[]
): LoadedRange {
  const drawingBounds = getDrawingTimeBounds(drawings);
  if (!drawingBounds) {
    return range;
  }

  let from = Math.min(range.from, drawingBounds.from);
  let to = Math.max(range.to, drawingBounds.to);

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
  inputId?: string;
  label?: string;
}

interface Mt5HistoryWorkspaceProps {
  onAvailabilityTextChange?: (text: string | null) => void;
  initialSymbol?: string;
  initialGoToDate?: string;
  onSymbolChange?: (symbol: string) => void;
  onTimeframeChange?: (timeframe: string) => void;
  onGoToDateChange?: (goToDate?: string) => void;
  onObservationApiChange?: (api: ChartObservationWorkspaceApi | null) => void;
  observationLoadRequest?: ChartObservationLoadRequest | null;
  onObservationLoadHandled?: (requestId: string) => void;
  isActive?: boolean;
  arePageTabsVisible?: boolean;
  onTogglePageTabsVisibility?: () => void;
  /** Hide drawing tools & action buttons for compact multi-pane layouts */
  compact?: boolean;
}

function SingleDatePopover({
  value,
  min,
  max,
  onClose,
  onApply,
  inputId = "mt5-history-go-to-date-input",
  label = "Go to date",
}: SingleDatePopoverProps) {
  const [tempDate, setTempDate] = useState<Date>(value);
  const [visibleMonth, setVisibleMonth] = useState<Date>(startOfMonth(value));
  const [inputValue, setInputValue] = useState(() => toDateInputValue(value.getTime()));
  const [isApplyEnabled, setIsApplyEnabled] = useState(true);

  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const firstWeekday = new Date(visibleMonth).getDay();
  const minMonth = startOfMonth(min);
  const maxMonth = startOfMonth(max);
  const minDateValue = toDateInputValue(min.getTime());
  const maxDateValue = toDateInputValue(max.getTime());
  const canGoPrev = visibleMonth.getTime() > minMonth.getTime();
  const canGoNext = visibleMonth.getTime() < maxMonth.getTime();
  const today = new Date();
  const dateInputError =
    inputValue.length === 0
      ? "Enter a date."
      : parseDateInputValue(inputValue) === null
        ? "Use YYYY-MM-DD."
        : inputValue < minDateValue || inputValue > maxDateValue
          ? `Date must be between ${minDateValue} and ${maxDateValue}.`
          : null;

  const updateSelectedDate = (nextDate: Date) => {
    setTempDate(nextDate);
    setVisibleMonth(startOfMonth(nextDate));
    setInputValue(toDateInputValue(nextDate.getTime()));
    setIsApplyEnabled(true);
  };

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

      <div className="mb-3">
        <label
          htmlFor={inputId}
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          {label}
        </label>
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={(event) => {
            const nextValue = event.target.value.trim();
            setInputValue(nextValue);

            const parsedDate = parseDateInputValue(nextValue);
            if (
              parsedDate === null ||
              nextValue < minDateValue ||
              nextValue > maxDateValue
            ) {
              setIsApplyEnabled(false);
              return;
            }

            setTempDate(parsedDate);
            setVisibleMonth(startOfMonth(parsedDate));
            setIsApplyEnabled(true);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;

            event.preventDefault();
            if (!isApplyEnabled || dateInputError) return;
            onApply(tempDate);
          }}
          placeholder="YYYY-MM-DD"
          autoComplete="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60"
          aria-invalid={dateInputError ? "true" : "false"}
          aria-describedby="mt5-history-go-to-date-help"
        />
        <p
          id="mt5-history-go-to-date-help"
          className={`mt-1 text-[10px] ${
            dateInputError ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {dateInputError ?? ""}
        </p>
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
              onClick={() => updateSelectedDate(day)}
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
          disabled={!isApplyEnabled || Boolean(dateInputError)}
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
  initialGoToDate,
  onSymbolChange,
  onTimeframeChange,
  onGoToDateChange,
  onObservationApiChange,
  observationLoadRequest,
  onObservationLoadHandled,
  isActive = true,
  arePageTabsVisible = true,
  onTogglePageTabsVisibility,
  compact = false,
}: Mt5HistoryWorkspaceProps) {
  const { user } = useAuth();
  const chartRef = useRef<TradeCandlestickChartRef | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const replayDatePickerRef = useRef<HTMLDivElement | null>(null);
  const loadedRangeRef = useRef<LoadedRange | null>(null);
  const requestedRangeRef = useRef<LoadedRange | null>(null);
  const activeSeriesKeyRef = useRef("");
  const loadGenerationRef = useRef(0);
  const suppressEdgeLoadingUntilRef = useRef(0);
  const suppressFocusTimestampLoadRef = useRef(false);
  const centerTimestampAfterLoadRef = useRef<number | null>(null);
  const shouldCenterOnNextDataRef = useRef(false);
  const skipAutoFitOnNextDataRef = useRef(false);
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
  const [mt5ServiceUrl, setMt5ServiceUrl] = useState("");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [isMetaLoading, setIsMetaLoading] = useState(true);

  const [symbol, setSymbol] = useState<string>("");
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("M1");
  const [goToDate, setGoToDate] = useState(initialGoToDate ?? "");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [focusTimestamp, setFocusTimestamp] = useState<number | null>(() => {
    const parsed = fromDateInputValue(initialGoToDate ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [chartInstanceKey, setChartInstanceKey] = useState(0);
  const [chartUpdateMode, setChartUpdateMode] = useState<HistoryChartUpdateMode>("replace");
  const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
  const [continuousDrawingEnabled, setContinuousDrawingEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHART_CONTINUOUS_DRAWING_KEY) === "true";
  });
  const [rectangleFillColor, setRectangleFillColor] = useState("#8b5cf6");
  const [rectangleFillOpacity, setRectangleFillOpacity] = useState(0.2);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState<DrawingToolType | null>(null);
  const [drawingsHidden, setDrawingsHidden] = useState(false);
  const [calloutText, setCalloutText] = useState("Text");
  const [calloutFontSize, setCalloutFontSize] = useState(18);
  const [calloutTextColor, setCalloutTextColor] = useState("#00ff66");
  const [calloutLineColor, setCalloutLineColor] = useState("#00ff66");
  const [calloutBoxColor, setCalloutBoxColor] = useState("rgba(0,0,0,0.88)");
  const [longShortLots, setLongShortLots] = useState(1);
  const [timeGuides, setTimeGuides] = useState<TimeGuideSettings>(() =>
    readStoredTimeGuideSettings(HISTORY_TIME_GUIDES_KEY)
  );
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplayPlacementMode, setIsReplayPlacementMode] = useState(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayStartIndex, setReplayStartIndex] = useState<number | null>(null);
  const [replayCursorTimestamp, setReplayCursorTimestamp] = useState<number | null>(null);
  const [replayStartTimestamp, setReplayStartTimestamp] = useState<number | null>(null);
  const [replayIntervalMs, setReplayIntervalMs] = useState<number>(DEFAULT_REPLAY_INTERVAL_MS);
  const [replayDataUpdateMode, setReplayDataUpdateMode] = useState<"replace" | "append" | "prepend">("replace");
  const [replayPlacementTimestamp, setReplayPlacementTimestamp] = useState<number | null>(null);
  const [replayStartMode, setReplayStartMode] = useState<ReplayStartMode>("bar");
  const [replayDate, setReplayDate] = useState(initialGoToDate ?? "");
  const [isReplayDatePickerOpen, setIsReplayDatePickerOpen] = useState(false);
  const [replayLoadTimestamp, setReplayLoadTimestamp] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(640);
  const [chartAreaHeight, setChartAreaHeight] = useState(520);
  const [compactDrawOpen, setCompactDrawOpen] = useState(false);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const [compactActionsPinned, setCompactActionsPinned] = useState(false);
  const compactDrawRef = useRef<HTMLDivElement>(null);
  const compactActionsRef = useRef<HTMLDivElement>(null);
  const replayTimerRef = useRef<number | null>(null);
  const isReplayModeRef = useRef(false);
  const isReplayPlacementModeRef = useRef(false);
  const pendingReplayStartTimestampRef = useRef<number | null>(null);
  const pendingReplayViewportRef = useRef<{ from: number; to: number } | null>(null);
  const replayViewportRef = useRef<{ from: number; to: number } | null>(null);
  const pendingRestoreRef = useRef<{
    drawings: DrawingToolExport[];
    centerTimestamp: number | null;
    windowSeconds?: number | null;
  } | null>(null);
  const lastHandledObservationRequestRef = useRef<string | null>(null);
  const skipNextCalloutApplyRef = useRef(false);
  const pendingAutoShowDrawingToolRef = useRef<DrawingToolType | null>(null);

  const closeCompactActions = useCallback(() => {
    setCompactActionsOpen(false);
    setCompactActionsPinned(false);
  }, []);
  const calloutTextInputRef = useRef<HTMLTextAreaElement>(null);

  const [bars, setBars] = useState<ChartBar[]>([]);
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);
  const [barsError, setBarsError] = useState<string | null>(null);
  const [isBarsLoading, setIsBarsLoading] = useState(false);
  const [isEdgeLoading, setIsEdgeLoading] = useState(false);
  const effectiveReplayIndex = useMemo(() => {
    if (!isReplayMode || bars.length === 0) {
      return null;
    }

    if (replayCursorTimestamp != null) {
      return findReplayStartIndex(bars, replayCursorTimestamp);
    }

    if (replayIndex == null) {
      return null;
    }

    return clampReplayIndex(replayIndex, bars.length);
  }, [bars, isReplayMode, replayCursorTimestamp, replayIndex]);
  const displayBars = useMemo(() => {
    if (effectiveReplayIndex == null) return bars;
    return bars.slice(0, effectiveReplayIndex + 1);
  }, [bars, effectiveReplayIndex]);
  const replayCanStepBack = effectiveReplayIndex != null && effectiveReplayIndex > 0;
  const replayCanStepForward =
    effectiveReplayIndex != null && effectiveReplayIndex < bars.length - 1;

  // Restore drawings and viewport after timeframe data loads
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || bars.length === 0 || isBarsLoading) return;
    pendingRestoreRef.current = null;
    const timer = window.setTimeout(() => {
      if (pending.drawings.length > 0) {
        chartRef.current?.importDrawings(pending.drawings);
      }
      if (pending.centerTimestamp != null) {
        chartRef.current?.scrollToTimestamp(
          pending.centerTimestamp,
          pending.windowSeconds ?? undefined
        );
      }
      centerTimestampAfterLoadRef.current = null;
      lastVisibleRangeRef.current = null;
      suppressEdgeLoadingUntilRef.current = Date.now() + 220;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [bars, isBarsLoading]);

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
  const replayMinDate = selectedTimeframe ? toDateInputValue(selectedTimeframe.from) : "";
  const replayMaxDate = selectedTimeframe ? toDateInputValue(selectedTimeframe.to) : "";
  const drawingFillRgba = useMemo(
    () => hexToRgba(rectangleFillColor, rectangleFillOpacity),
    [rectangleFillColor, rectangleFillOpacity]
  );
  const deleteSelectedDrawings = useCallback(() => {
    chartRef.current?.deleteSelectedDrawings();
    setSelectedDrawingTool(null);
  }, []);
  const toggleDrawingsHidden = useCallback(() => {
    setDrawingsHidden((current) => !current);
    setSelectedDrawingTool(null);
  }, []);

  useEffect(() => {
    if (!drawingsHidden) {
      const pendingTool = pendingAutoShowDrawingToolRef.current;
      if (pendingTool != null && drawingTool == null) {
        pendingAutoShowDrawingToolRef.current = null;
        setDrawingTool(pendingTool);
      }
      return;
    }
    if (drawingTool == null) return;
    pendingAutoShowDrawingToolRef.current = drawingTool;
    setDrawingTool(null);
    setDrawingsHidden(false);
  }, [drawingTool, drawingsHidden]);

  useEffect(() => {
    if (selectedDrawingTool !== "Callout") return;
    const config = chartRef.current?.getSelectedCalloutConfig();
    if (!config) return;
    skipNextCalloutApplyRef.current = true;
    setCalloutText(config.text || "Text");
    setCalloutFontSize(config.fontSize || 18);
    setCalloutTextColor(config.textColor || "#00ff66");
    setCalloutLineColor(config.lineColor || "#00ff66");
    setCalloutBoxColor(config.boxColor || "rgba(0,0,0,0.88)");
  }, [selectedDrawingTool]);

  useEffect(() => {
    if (selectedDrawingTool !== "Callout") return;
    if (skipNextCalloutApplyRef.current) {
      skipNextCalloutApplyRef.current = false;
      return;
    }
    chartRef.current?.updateSelectedCallout({
      text: calloutText,
      fontSize: calloutFontSize,
      textColor: calloutTextColor,
      lineColor: calloutLineColor,
      boxColor: calloutBoxColor,
    });
  }, [calloutBoxColor, calloutFontSize, calloutLineColor, calloutText, calloutTextColor, selectedDrawingTool]);

  const handleCalloutTextKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.blur();
  }, []);

  const activeSeriesKey = `${symbol}|${selectedTimeframe?.timeframe ?? ""}`;
  const resolvedMt5ServiceUrl = useMemo(() => {
    const configured = normalizeMt5ServiceUrl(mt5ServiceUrl);
    return configured || DEFAULT_MT5_LOCAL_SERVICE_URL;
  }, [mt5ServiceUrl]);

  const loadMeta = useCallback(
    async (options?: {
      preferredSymbol?: string;
      preferredTimeframe?: ChartTimeframe;
    }): Promise<{
      data: MetaResponse;
      selection: { symbol: string; timeframe: ChartTimeframe; summary: TimeframeSummary } | null;
    }> => {
      const params = new URLSearchParams();
      if (historyRootPath) {
        params.set("rootPath", historyRootPath);
      }
      const endpoint = buildMt5ServiceEndpoint(
        "/api/mt5/history/meta",
        resolvedMt5ServiceUrl
      );
      const response = await fetch(
        `${endpoint}${params.toString() ? `?${params.toString()}` : ""}`,
        { cache: "no-store" }
      );
      const data = (await response.json()) as MetaResponse;
      if (!response.ok) {
        throw new Error(data.error ?? "Failed to load MT5 history metadata.");
      }

      const selection = resolvePreferredSelection(
        data.symbols,
        options?.preferredSymbol ?? symbol,
        options?.preferredTimeframe ?? timeframe,
        initialSymbol
      );

      return { data, selection };
    },
    [historyRootPath, initialSymbol, resolvedMt5ServiceUrl, symbol, timeframe]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(HISTORY_TIME_GUIDES_KEY, JSON.stringify(timeGuides));
  }, [timeGuides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CHART_CONTINUOUS_DRAWING_KEY,
      continuousDrawingEnabled ? "true" : "false"
    );
  }, [continuousDrawingEnabled]);

  useEffect(() => {
    let cancelled = false;

    const loadRootPath = async () => {
      try {
        const repo = createSettingsRepository(user?.id);
        const [rootRecord, serviceRecord] = await Promise.all([
          repo.get(MT5_HISTORY_ROOT_SETTING_KEY),
          repo.get(MT5_LOCAL_SERVICE_URL_SETTING_KEY),
        ]);
        if (cancelled) return;
        setHistoryRootPath(
          typeof rootRecord?.value === "string" ? rootRecord.value.trim() : ""
        );
        setMt5ServiceUrl(
          typeof serviceRecord?.value === "string" ? serviceRecord.value.trim() : ""
        );
      } catch {
        if (!cancelled) {
          setHistoryRootPath("");
          setMt5ServiceUrl("");
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
    const element = chartAreaRef.current;
    if (!element) return;

    const updateHeight = () => {
      setExpandedHeight(Math.max(360, element.clientHeight || 0));
    };

    updateHeight();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updateHeight())
        : null;
    observer?.observe(element);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsExpanded(false);
    };
    window.addEventListener("resize", updateHeight);
    window.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      observer?.disconnect();
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
    if (!isActive) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isActive) return;
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
      if (key === "b") {
        event.preventDefault();
        toggleTool("Brush");
      }
      if (key === "g") {
        event.preventDefault();
        toggleTool("Gan");
      }
      if (key === "h") {
        event.preventDefault();
        toggleTool("HorizontalRay");
      }
      if (key === "p") {
        event.preventDefault();
        toggleTool("Path");
      }
      if (key === "m" || key === "x") {
        event.preventDefault();
        toggleTool("Callout");
      }
      if (key === "s" || key === "l") {
        event.preventDefault();
        toggleTool("LongShortPosition");
      }
      if (key === "f") {
        event.preventDefault();
        chartRef.current?.fitContent();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isActive]);

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
    if (!isReplayDatePickerOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!replayDatePickerRef.current?.contains(target)) {
        setIsReplayDatePickerOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsReplayDatePickerOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isReplayDatePickerOpen]);

  useEffect(() => {
    if (!compactActionsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!compactActionsRef.current?.contains(target)) {
        closeCompactActions();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCompactActions();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [closeCompactActions, compactActionsOpen]);

  useEffect(() => {
    let cancelled = false;

    const hydrateMeta = async () => {
      setIsMetaLoading(true);
      setMetaError(null);
      try {
        const { data, selection } = await loadMeta();
        if (cancelled) return;

        setMeta(data);
        if (selection) {
          setSymbol(selection.symbol);
          setTimeframe(selection.timeframe);
        }
      } catch (error) {
        if (!cancelled) {
          const fallbackMessage =
            resolvedMt5ServiceUrl && error instanceof TypeError
              ? `Could not reach the local MT5 service at ${resolvedMt5ServiceUrl}. Start it with \`npm run mt5:service\` on this computer.`
              : "Failed to load MT5 metadata.";
          setMetaError(
            error instanceof TypeError ? fallbackMessage : error instanceof Error ? error.message : fallbackMessage
          );
        }
      } finally {
        if (!cancelled) {
          setIsMetaLoading(false);
        }
      }
    };

    void hydrateMeta();

    return () => {
      cancelled = true;
    };
  }, [loadMeta, resolvedMt5ServiceUrl]);

  useEffect(() => {
    if (!selectedSymbol) return;
    if (availableTimeframes.length === 0) return;
    if (availableTimeframes.some((item) => item.timeframe === timeframe)) return;
    setTimeframe(availableTimeframes[0].timeframe);
  }, [availableTimeframes, selectedSymbol, timeframe]);

  useEffect(() => {
    if (!selectedTimeframe) {
      setReplayDate("");
      return;
    }

    const candidate = replayDate || goToDate || toDateInputValue(selectedTimeframe.to);
    const clamped = candidate < replayMinDate
      ? replayMinDate
      : candidate > replayMaxDate
        ? replayMaxDate
        : candidate;
    if (clamped !== replayDate) {
      setReplayDate(clamped);
    }
  }, [goToDate, replayDate, replayMaxDate, replayMinDate, selectedTimeframe]);

  // Report values to parent so tab labels are correct
  useEffect(() => {
    if (symbol) onSymbolChange?.(symbol);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  useEffect(() => {
    if (timeframe) onTimeframeChange?.(timeframe);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  useEffect(() => {
    onGoToDateChange?.(goToDate || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToDate]);

  useEffect(() => {
    isReplayModeRef.current = isReplayMode;
  }, [isReplayMode]);

  useEffect(() => {
    isReplayPlacementModeRef.current = isReplayPlacementMode;
  }, [isReplayPlacementMode]);

  useEffect(() => {
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setIsReplayPlacementMode(false);
    setReplayIndex(null);
    setReplayStartIndex(null);
    setReplayCursorTimestamp(null);
    setReplayStartTimestamp(null);
    setReplayDataUpdateMode("replace");
    setReplayPlacementTimestamp(null);
    setReplayLoadTimestamp(null);
    pendingReplayStartTimestampRef.current = null;
    pendingReplayViewportRef.current = null;
    replayViewportRef.current = null;
  }, [symbol]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current != null) {
        window.clearTimeout(replayTimerRef.current);
      }
    };
  }, []);

  const exitReplay = useCallback(() => {
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setIsReplayPlacementMode(false);
    setReplayIndex(null);
    setReplayStartIndex(null);
    setReplayCursorTimestamp(null);
    setReplayStartTimestamp(null);
    setReplayDataUpdateMode("replace");
    setReplayPlacementTimestamp(null);
    setReplayLoadTimestamp(null);
    pendingReplayStartTimestampRef.current = null;
    pendingReplayViewportRef.current = null;
    replayViewportRef.current = null;
  }, []);

  const startReplayAtTimestamp = useCallback(
    (timestamp: number) => {
      if (bars.length === 0) return;
      loadGenerationRef.current += 1;
      fetchingPrevRef.current = false;
      fetchingNextRef.current = false;
      pendingPrevFetchRef.current = false;
      pendingNextFetchRef.current = false;
      lastRequestedPrevRangeKeyRef.current = "";
      lastRequestedNextRangeKeyRef.current = "";
      lastPrevFetchRef.current = 0;
      lastNextFetchRef.current = 0;
      lastVisibleRangeRef.current = null;
      suppressEdgeLoadingUntilRef.current = Date.now() + 500;
      setIsEdgeLoading(false);
      const currentViewport = chartRef.current?.getVisibleLogicalRange() ?? null;
      pendingReplayViewportRef.current = currentViewport;
      replayViewportRef.current = currentViewport;
      const anchorIndex = findReplayStartIndex(bars, timestamp);
      const anchorTimestamp = bars[anchorIndex]?.timestamp ?? timestamp;
      setIsReplayPlaying(false);
      setIsReplayPlacementMode(false);
      setReplayDataUpdateMode("replace");
      setReplayPlacementTimestamp(anchorTimestamp);
      setIsReplayMode(true);
      setReplayStartIndex(anchorIndex);
      setReplayStartTimestamp(anchorTimestamp);
      setReplayIndex(anchorIndex);
      setReplayCursorTimestamp(anchorTimestamp);
    },
    [bars]
  );

  const getReplayAnchorIndex = useCallback(() => {
    if (bars.length === 0) return 0;
    const anchorTimestamp =
      chartRef.current?.getViewportCenterTimestamp() ??
      focusTimestamp ??
      bars[bars.length - 1]?.timestamp ??
      null;
    return findNearestReplayIndex(bars, anchorTimestamp);
  }, [bars, focusTimestamp]);

  const getReplayRestoreTimestamp = useCallback(() => {
    return (
      replayCursorTimestamp ??
      replayPlacementTimestamp ??
      replayStartTimestamp ??
      chartRef.current?.getViewportCenterTimestamp() ??
      focusTimestamp ??
      null
    );
  }, [focusTimestamp, replayCursorTimestamp, replayPlacementTimestamp, replayStartTimestamp]);

  const startReplayFromDateTimestamp = useCallback((targetTimestamp: number) => {
    if (!selectedTimeframe || bars.length === 0) return;

    const clampedTarget = Math.max(
      selectedTimeframe.from,
      Math.min(selectedTimeframe.to, targetTimestamp)
    );

    setIsReplayPlaying(false);
    setIsReplayPlacementMode(false);
    setReplayPlacementTimestamp(null);
    setIsReplayDatePickerOpen(false);
    closeCompactActions();
    setCompactDrawOpen(false);

    if (
      bars[0] &&
      bars[bars.length - 1] &&
      clampedTarget >= bars[0].timestamp &&
      clampedTarget <= bars[bars.length - 1].timestamp
    ) {
      startReplayAtTimestamp(clampedTarget);
      return;
    }

    pendingReplayStartTimestampRef.current = clampedTarget;
    setReplayLoadTimestamp(clampedTarget);
  }, [bars, closeCompactActions, selectedTimeframe, startReplayAtTimestamp]);

  const handleReplayToggle = useCallback(() => {
    if (isReplayMode) {
      exitReplay();
      return;
    }

    if (isReplayPlacementMode) {
      setIsReplayPlacementMode(false);
      setReplayPlacementTimestamp(null);
      return;
    }

    if (bars.length === 0) return;

    if (replayStartMode === "date") {
      const targetTimestamp = fromDateInputValue(replayDate);
      if (!Number.isFinite(targetTimestamp) || !selectedTimeframe) return;
      startReplayFromDateTimestamp(targetTimestamp);
      return;
    }

    const anchorIndex = getReplayAnchorIndex();
    setIsReplayPlaying(false);
    setIsReplayPlacementMode(true);
    setReplayPlacementTimestamp(bars[anchorIndex]?.timestamp ?? null);
    setIsReplayDatePickerOpen(false);
    closeCompactActions();
    setCompactDrawOpen(false);
  }, [
    bars,
    closeCompactActions,
    exitReplay,
    getReplayAnchorIndex,
    isReplayMode,
    isReplayPlacementMode,
    replayDate,
    replayStartMode,
    selectedTimeframe,
    startReplayFromDateTimestamp,
  ]);

  const stepReplay = useCallback(
    (delta: number) => {
      if (bars.length === 0) return;
      const currentViewport =
        chartRef.current?.getVisibleLogicalRange() ?? replayViewportRef.current;
      replayViewportRef.current = currentViewport;
      pendingReplayViewportRef.current = delta > 0 ? null : currentViewport;
      setIsReplayPlaying(false);
      setReplayDataUpdateMode(delta > 0 ? "append" : "replace");
      const baseIndex = effectiveReplayIndex ?? replayIndex ?? getReplayAnchorIndex();
      const nextIndex = clampReplayIndex(baseIndex + delta, bars.length);
      setReplayIndex(nextIndex);
      setReplayCursorTimestamp(bars[nextIndex]?.timestamp ?? null);
    },
    [bars, effectiveReplayIndex, getReplayAnchorIndex, replayIndex]
  );

  const handleReplayReset = useCallback(() => {
    if (bars.length === 0) return;
    const currentViewport =
      chartRef.current?.getVisibleLogicalRange() ?? replayViewportRef.current;
    pendingReplayViewportRef.current = currentViewport;
    replayViewportRef.current = currentViewport;
    setReplayDataUpdateMode("replace");
    const anchorTimestamp =
      replayStartTimestamp ??
      (replayStartIndex != null ? bars[replayStartIndex]?.timestamp ?? null : null);
    if (anchorTimestamp == null) return;
    const anchorIndex = findReplayStartIndex(bars, anchorTimestamp);
    setIsReplayPlaying(false);
    setReplayStartIndex(anchorIndex);
    setReplayIndex(anchorIndex);
    setReplayCursorTimestamp(bars[anchorIndex]?.timestamp ?? anchorTimestamp);
  }, [bars, replayStartIndex, replayStartTimestamp]);

  useEffect(() => {
    if (!isReplayMode) return;

    const handleReplayKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (event.key !== "ArrowUp") return;
      event.preventDefault();
      event.stopPropagation();
      stepReplay(1);
    };

    window.addEventListener("keydown", handleReplayKeyDown, true);
    return () => window.removeEventListener("keydown", handleReplayKeyDown, true);
  }, [isReplayMode, stepReplay]);

  const observationApi = useMemo<ChartObservationWorkspaceApi>(
    () => ({
      workspaceMode: "history",
      symbol: symbol || null,
      broker: null,
      timeframe: timeframe || null,
      captureObservationContext: () => {
        const centerTimestamp = chartRef.current?.getViewportCenterTimestamp() ?? null;
        const windowSeconds = chartRef.current?.getVisibleWindowSeconds() ?? null;
        const drawings = filterDrawingsToVisibleWindow(
          chartRef.current?.exportAllDrawings() ?? [],
          centerTimestamp,
          windowSeconds
        );

        return {
          workspaceMode: "history",
          broker: null,
          symbol: symbol || null,
          timeframe: timeframe || null,
          centerTimestamp,
          windowSeconds,
          drawings,
        };
      },
    }),
    [symbol, timeframe]
  );

  useEffect(() => {
    if (!onObservationApiChange) return;
    if (!isActive) {
      onObservationApiChange(null);
      return;
    }
    onObservationApiChange(observationApi);
    return () => onObservationApiChange(null);
  }, [isActive, observationApi, onObservationApiChange]);

  useEffect(() => {
    if (isActive) return;

    setIsReplayPlaying(false);
    setIsReplayPlacementMode(false);
    chartRef.current?.cancelActiveDrawing();
    setDrawingTool(null);
    setSelectedDrawingTool(null);
    setCompactDrawOpen(false);
  }, [isActive]);

  useEffect(() => {
    const request = observationLoadRequest;
    if (!request) return;
    if (request.context.workspaceMode && request.context.workspaceMode !== "history") {
      return;
    }
    if (lastHandledObservationRequestRef.current === request.requestId) {
      return;
    }

    lastHandledObservationRequestRef.current = request.requestId;
    exitReplay();
    const nextSymbol = request.context.symbol ?? symbol;
    const nextTimeframe = request.context.timeframe ?? timeframe;
    const drawings = (request.context.drawings ?? []) as DrawingToolExport[];
    const pending = {
      drawings,
      centerTimestamp: request.context.centerTimestamp ?? null,
      windowSeconds: request.context.windowSeconds ?? null,
    };

    skipAutoFitOnNextDataRef.current = true;

    if (nextSymbol && nextSymbol !== symbol) {
      setSymbol(nextSymbol);
      onSymbolChange?.(nextSymbol);
    }

    if (nextTimeframe && nextTimeframe !== timeframe) {
      setTimeframe(nextTimeframe);
      onTimeframeChange?.(nextTimeframe);
    }

    if (pending.centerTimestamp != null) {
      setFocusTimestamp(pending.centerTimestamp);
    }
    pendingRestoreRef.current = pending;

    const symbolMatches = !nextSymbol || nextSymbol === symbol;
    const timeframeMatches = !nextTimeframe || nextTimeframe === timeframe;
    if (symbolMatches && timeframeMatches && bars.length > 0 && !isBarsLoading) {
      pendingRestoreRef.current = null;
      window.setTimeout(() => {
        if (pending.drawings.length > 0) {
          chartRef.current?.importDrawings(pending.drawings);
        }
        if (pending.centerTimestamp != null) {
          chartRef.current?.scrollToTimestamp(
            pending.centerTimestamp,
            pending.windowSeconds ?? undefined
          );
        }
      }, 0);
    }

    onObservationLoadHandled?.(request.requestId);
  }, [
    bars.length,
    exitReplay,
    isBarsLoading,
    observationLoadRequest,
    onObservationLoadHandled,
    onSymbolChange,
    onTimeframeChange,
    symbol,
    timeframe,
  ]);

  useEffect(() => {
    if (!isReplayMode) return;
    if (bars.length === 0) {
      if (isBarsLoading) return;
      setIsReplayPlaying(false);
      return;
    }

    const fallbackIndex = getReplayAnchorIndex();
    const resolvedStartTimestamp =
      replayStartTimestamp ?? bars[fallbackIndex]?.timestamp ?? null;
    const resolvedCursorTimestamp =
      replayCursorTimestamp ?? resolvedStartTimestamp;

    const nextStartIndex =
      resolvedStartTimestamp == null
        ? fallbackIndex
        : findReplayStartIndex(bars, resolvedStartTimestamp);
    const nextCursorIndex =
      resolvedCursorTimestamp == null
        ? nextStartIndex
        : findReplayStartIndex(bars, resolvedCursorTimestamp);

    setReplayStartIndex(nextStartIndex);
    setReplayIndex(nextCursorIndex);
    setReplayStartTimestamp(bars[nextStartIndex]?.timestamp ?? resolvedStartTimestamp);
    setReplayCursorTimestamp(bars[nextCursorIndex]?.timestamp ?? resolvedCursorTimestamp);
  }, [
    bars,
    getReplayAnchorIndex,
    isBarsLoading,
    isReplayMode,
    replayCursorTimestamp,
    replayStartTimestamp,
  ]);

  useEffect(() => {
    if (!isReplayMode || !isReplayPlaying || effectiveReplayIndex == null) return;

    if (effectiveReplayIndex >= bars.length - 1) {
      setIsReplayPlaying(false);
      return;
    }

    replayTimerRef.current = window.setTimeout(() => {
      setReplayDataUpdateMode("append");
      const nextIndex = clampReplayIndex(effectiveReplayIndex + 1, bars.length);
      setReplayIndex(nextIndex);
      setReplayCursorTimestamp(bars[nextIndex]?.timestamp ?? null);
    }, replayIntervalMs);

    return () => {
      if (replayTimerRef.current != null) {
        window.clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
    };
  }, [
    bars,
    effectiveReplayIndex,
    isReplayMode,
    isReplayPlaying,
    replayIntervalMs,
  ]);

  useEffect(() => {
    if (!isReplayMode || displayBars.length === 0) return;
    const pendingViewport = pendingReplayViewportRef.current;
    if (!pendingViewport) return;

    pendingReplayViewportRef.current = null;
    const timer = window.setTimeout(() => {
      chartRef.current?.setVisibleLogicalRange(pendingViewport);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [displayBars.length, isReplayMode]);

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

      const endpoint = buildMt5ServiceEndpoint(
        "/api/mt5/history/bars",
        resolvedMt5ServiceUrl
      );
      const response = await fetch(`${endpoint}?${params.toString()}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as BarsResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to load MT5 bars.");
      }
      return payload.bars;
    },
    [historyRootPath, resolvedMt5ServiceUrl, selectedTimeframe, symbol]
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
        const fallbackMessage =
          resolvedMt5ServiceUrl && error instanceof TypeError
            ? `Could not reach the local MT5 service at ${resolvedMt5ServiceUrl}. Start it with \`npm run mt5:service\` on this computer.`
            : "Failed to load MT5 bars.";
        setBarsError(
          error instanceof TypeError ? fallbackMessage : error instanceof Error ? error.message : fallbackMessage
        );
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
    [requestBars, resolvedMt5ServiceUrl, selectedTimeframe, symbol]
  );

  const goToTimestamp = useCallback(
    async (targetTimestamp: number, options?: { preserveReplay?: boolean }) => {
      if (!selectedTimeframe || !symbol) return;
      if (!options?.preserveReplay) {
        exitReplay();
      } else {
        setIsReplayPlaying(false);
      }
      const pendingRestore = pendingRestoreRef.current;
      const range = extendRangeToIncludeDrawings(
        buildCenteredRange(selectedTimeframe, targetTimestamp),
        selectedTimeframe,
        pendingRestore?.drawings ?? []
      );
      const clampedTarget = Math.max(
        selectedTimeframe.from,
        Math.min(selectedTimeframe.to, targetTimestamp)
      );

      shouldCenterOnNextDataRef.current = true;
      centerTimestampAfterLoadRef.current = clampedTarget;
      suppressFocusTimestampLoadRef.current = true;
      setFocusTimestamp(clampedTarget);
      setGoToDate(toDateInputValue(clampedTarget));
      await loadWindow(range, "replace");
    },
    [exitReplay, loadWindow, selectedTimeframe, symbol]
  );

  useEffect(() => {
    if (!selectedTimeframe || !symbol) return;
    if (suppressFocusTimestampLoadRef.current) {
      suppressFocusTimestampLoadRef.current = false;
      return;
    }
    const pendingCenterTimestamp = pendingRestoreRef.current?.centerTimestamp;
    const preserveReplay =
      pendingReplayStartTimestampRef.current != null ||
      (pendingCenterTimestamp != null &&
        (isReplayModeRef.current || isReplayPlacementModeRef.current));
    void goToTimestamp(
      pendingCenterTimestamp ?? focusTimestamp ?? selectedTimeframe.to,
      preserveReplay ? { preserveReplay: true } : undefined
    );
  }, [focusTimestamp, goToTimestamp, selectedTimeframe, symbol]);

  useEffect(() => {
    if (replayLoadTimestamp == null) return;
    setReplayLoadTimestamp(null);
    void goToTimestamp(replayLoadTimestamp, { preserveReplay: true });
  }, [goToTimestamp, replayLoadTimestamp]);

  useEffect(() => {
    const pendingReplayStartTimestamp = pendingReplayStartTimestampRef.current;
    if (pendingReplayStartTimestamp == null || isBarsLoading || bars.length === 0) return;

    const loadedFrom = bars[0]?.timestamp ?? null;
    const loadedTo = bars[bars.length - 1]?.timestamp ?? null;
    if (
      loadedFrom == null ||
      loadedTo == null ||
      pendingReplayStartTimestamp < loadedFrom ||
      pendingReplayStartTimestamp > loadedTo
    ) {
      return;
    }

    pendingReplayStartTimestampRef.current = null;
    startReplayAtTimestamp(pendingReplayStartTimestamp);
  }, [bars, isBarsLoading, startReplayAtTimestamp]);

  useEffect(() => {
    if (!shouldCenterOnNextDataRef.current || bars.length === 0) return;
    shouldCenterOnNextDataRef.current = false;
    if (skipAutoFitOnNextDataRef.current) {
      skipAutoFitOnNextDataRef.current = false;
      centerTimestampAfterLoadRef.current = null;
      return;
    }
    window.setTimeout(() => {
      const targetTimestamp =
        centerTimestampAfterLoadRef.current ??
        pendingRestoreRef.current?.centerTimestamp ??
        focusTimestamp;
      const loadedRange = loadedRangeRef.current;
      const windowSeconds =
        loadedRange != null
          ? Math.max(1, (loadedRange.to - loadedRange.from) / 1000)
          : undefined;

      centerTimestampAfterLoadRef.current = null;
      if (targetTimestamp != null) {
        chartRef.current?.scrollToTimestamp(targetTimestamp, windowSeconds);
      } else {
        chartRef.current?.fitContent();
      }
      lastVisibleRangeRef.current = null;
      suppressEdgeLoadingUntilRef.current = Date.now() + 220;
    }, 80);
  }, [bars, focusTimestamp]);

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
      if (isReplayModeRef.current) {
        setReplayDataUpdateMode("prepend");
      }
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
      if (isReplayModeRef.current) {
        setReplayDataUpdateMode("append");
      }
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

  useEffect(() => {
    if (
      !isReplayMode ||
      !isReplayPlaying ||
      effectiveReplayIndex == null ||
      bars.length === 0
    ) {
      return;
    }

    if (bars.length - 1 - effectiveReplayIndex <= 10) {
      void fetchNext();
    }
  }, [bars.length, effectiveReplayIndex, fetchNext, isReplayMode, isReplayPlaying]);

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

      if (isReplayMode) {
        replayViewportRef.current = { from, to };
      }

      const leftIndex = Math.floor(from);
      const rightIndex = Math.ceil(to);
      const nearLeft = leftIndex <= EDGE_FETCH_THRESHOLD;
      const nearRight = rightIndex >= currentBarsLength - EDGE_FETCH_THRESHOLD;
      const edgeLoadingLocked = isReplayPlacementMode;

      let shouldFetchPrev = nearLeft && !edgeLoadingLocked;
      let shouldFetchNext =
        !edgeLoadingLocked &&
        nearRight &&
        (!isReplayMode ||
          effectiveReplayIndex == null ||
          effectiveReplayIndex >= bars.length - 1);

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
    [bars.length, effectiveReplayIndex, fetchNext, fetchPrevious, isReplayMode, isReplayPlacementMode]
  );

  const applyGoToDate = useCallback(
    (date: Date) => {
      if (!selectedTimeframe) return;

      const targetTimestamp = fromDateInputValue(toDateInputValue(date.getTime()));
      if (!Number.isFinite(targetTimestamp)) return;

      const minTimestamp = fromDateInputValue(toDateInputValue(selectedTimeframe.from));
      const maxTimestamp = fromDateInputValue(toDateInputValue(selectedTimeframe.to));
      const clampedTarget = Math.max(
        minTimestamp,
        Math.min(maxTimestamp, targetTimestamp)
      );

      setGoToDate(toDateInputValue(clampedTarget));
      setIsDatePickerOpen(false);
      void goToTimestamp(clampedTarget);
    },
    [goToTimestamp, selectedTimeframe]
  );

  const applyReplayDate = useCallback((date: Date) => {
    if (!selectedTimeframe) return;

    const targetTimestamp = fromDateInputValue(toDateInputValue(date.getTime()));
    if (!Number.isFinite(targetTimestamp)) return;

    const minTimestamp = fromDateInputValue(toDateInputValue(selectedTimeframe.from));
    const maxTimestamp = fromDateInputValue(toDateInputValue(selectedTimeframe.to));
    const clampedTarget = Math.max(
      minTimestamp,
      Math.min(maxTimestamp, targetTimestamp)
    );

    setReplayDate(toDateInputValue(clampedTarget));
    setIsReplayDatePickerOpen(false);
    startReplayFromDateTimestamp(clampedTarget);
  }, [selectedTimeframe, startReplayFromDateTimestamp]);

  const refreshCurrentView = useCallback(() => {
    if (!selectedTimeframe) return;

    void (async () => {
      exitReplay();
      const previousLatestTimestamp = selectedTimeframe.to;
      setIsMetaLoading(true);
      setMetaError(null);
      try {
        const { data, selection } = await loadMeta({
          preferredSymbol: symbol,
          preferredTimeframe: timeframe,
        });
        setMeta(data);
        if (selection) {
          setSymbol(selection.symbol);
          setTimeframe(selection.timeframe);
          const target =
            selection.summary.to > previousLatestTimestamp
              ? selection.summary.to
              : focusTimestamp ?? selection.summary.to;
          const clampedTarget = Math.max(
            selection.summary.from,
            Math.min(selection.summary.to, target)
          );
          const range = extendRangeToIncludeDrawings(
            buildCenteredRange(selection.summary, clampedTarget),
            selection.summary,
            chartRef.current?.exportAllDrawings() ?? []
          );
          shouldCenterOnNextDataRef.current = true;
          centerTimestampAfterLoadRef.current = clampedTarget;
          suppressFocusTimestampLoadRef.current = true;
          setFocusTimestamp(clampedTarget);
          setGoToDate(toDateInputValue(clampedTarget));
          await loadWindow(range, "replace");
          return;
        }
        await goToTimestamp(focusTimestamp ?? previousLatestTimestamp);
      } catch (error) {
        const fallbackMessage =
          resolvedMt5ServiceUrl && error instanceof TypeError
            ? `Could not reach the local MT5 service at ${resolvedMt5ServiceUrl}. Start it with \`npm run mt5:service\` on this computer.`
            : "Failed to load MT5 metadata.";
        setMetaError(
          error instanceof TypeError
            ? fallbackMessage
            : error instanceof Error
              ? error.message
              : fallbackMessage
        );
      } finally {
        setIsMetaLoading(false);
      }
    })();
  }, [
    exitReplay,
    focusTimestamp,
    goToTimestamp,
    loadWindow,
    loadMeta,
    resolvedMt5ServiceUrl,
    selectedTimeframe,
    symbol,
    timeframe,
  ]);

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

  useEffect(() => {
    if (isActive) return;

    chartRef.current?.cancelActiveDrawing();
    setDrawingTool(null);
    setSelectedDrawingTool(null);
    setCompactDrawOpen(false);
  }, [isActive]);

  const toolbar = (
    <div className={`relative z-20 flex flex-wrap items-center gap-2 border-b border-border ${compact ? 'pb-1.5' : 'pb-3'}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
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
          const replayRestoreTimestamp =
            isReplayMode || isReplayPlacementMode
              ? getReplayRestoreTimestamp()
              : null;
          // Save drawings and viewport before timeframe change
          skipAutoFitOnNextDataRef.current = true;
          pendingRestoreRef.current = {
            drawings: chartRef.current?.exportAllDrawings() ?? [],
            centerTimestamp:
              replayRestoreTimestamp ??
              chartRef.current?.getViewportCenterTimestamp() ??
              null,
            windowSeconds: chartRef.current?.getVisibleWindowSeconds() ?? null,
          };
          if (isReplayMode || isReplayPlacementMode) {
            setIsReplayPlaying(false);
          }
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

      <TimeGuidesControls
        value={timeGuides}
        onChange={setTimeGuides}
        compact={compact}
        disabled={!selectedTimeframe}
      />

      <div className="flex items-center gap-1">
        {!isReplayMode && !isReplayPlacementMode ? (
          <div className="flex h-7 items-center gap-1 rounded border border-border bg-background px-1">
            <select
              value={replayStartMode}
              onChange={(event) => {
                const nextMode = event.target.value as ReplayStartMode;
                setReplayStartMode(nextMode);
                if (nextMode !== "date") {
                  setIsReplayDatePickerOpen(false);
                }
              }}
              disabled={!selectedTimeframe}
              className="h-5 rounded border border-border bg-background px-1 text-[10px] text-foreground"
              aria-label="Replay start mode"
              title="Replay start mode"
            >
              <option value="bar">Bar</option>
              <option value="date">Date</option>
            </select>
            {replayStartMode === "date" ? (
              <div className="relative" ref={replayDatePickerRef}>
                <button
                  type="button"
                  onClick={() => setIsReplayDatePickerOpen((current) => !current)}
                  disabled={!selectedTimeframe || !replayDate}
                  className="flex h-5 min-w-[92px] items-center gap-1 rounded border border-border bg-background px-1 text-[10px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Replay start date"
                  title="Replay start date"
                >
                  <Calendar className="h-3 w-3 text-muted-foreground" />
                  <span className="whitespace-nowrap">
                    {replayDate ? format(new Date(`${replayDate}T00:00:00`), "MMM d") : "Date"}
                  </span>
                </button>
                {isReplayDatePickerOpen && selectedTimeframe && replayDate ? (
                  <SingleDatePopover
                    key={`replay-${replayDate}`}
                    value={new Date(`${replayDate}T00:00:00`)}
                    min={new Date(selectedTimeframe.from)}
                    max={new Date(selectedTimeframe.to)}
                    inputId="mt5-history-replay-date-input"
                    label="Replay date"
                    onClose={() => setIsReplayDatePickerOpen(false)}
                    onApply={applyReplayDate}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <button
          type="button"
          onClick={handleReplayToggle}
          disabled={
            !selectedTimeframe ||
            bars.length === 0 ||
            (replayStartMode === "date" && !parseDateInputValue(replayDate))
          }
          className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
            isReplayMode || isReplayPlacementMode
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title={
            isReplayMode
              ? "Exit replay mode"
              : isReplayPlacementMode
                ? "Cancel replay placement"
                : replayStartMode === "bar"
                  ? "Pick replay start on chart"
                  : replayStartMode === "date"
                    ? "Start replay at selected date"
                    : "Start replay"
          }
        >
          {isReplayMode ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>
            {isReplayMode ? "Exit" : isReplayPlacementMode ? "Cancel" : "Replay"}
          </span>
        </button>

        {isReplayMode ? (
          <div className="flex h-7 items-center gap-1 rounded border border-border bg-background px-1.5">
            <button
              type="button"
              onClick={handleReplayReset}
              disabled={replayStartIndex == null}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="Restart replay"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => stepReplay(-1)}
              disabled={!replayCanStepBack}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="Previous bar"
            >
              <SkipBack className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => setIsReplayPlaying((current) => !current)}
              disabled={!replayCanStepForward}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title={isReplayPlaying ? "Pause replay" : "Play replay"}
            >
              {isReplayPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <button
              type="button"
              onClick={() => stepReplay(1)}
              disabled={!replayCanStepForward}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              title="Next bar"
            >
              <SkipForward className="h-3 w-3" />
            </button>
            <select
              value={replayIntervalMs}
              onChange={(event) => setReplayIntervalMs(Number(event.target.value))}
              className="h-5 rounded border border-border bg-background px-1 text-[10px] text-foreground"
              aria-label="Replay speed"
            >
              {REPLAY_SPEED_OPTIONS.map((option) => (
                <option key={option.intervalMs} value={option.intervalMs}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              {effectiveReplayIndex != null ? `${effectiveReplayIndex + 1}/${bars.length}` : "0/0"}
            </span>
          </div>
        ) : null}
    
      </div>

      {!compact ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {DRAW_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              onClick={() => setDrawingTool((current) => current === tool.id ? null : tool.id)}
              disabled={!selectedTimeframe}
              className={`flex h-7 w-7 items-center justify-center rounded-md border transition-colors ${
                drawingTool === tool.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
              title={tool.label}
              aria-label={tool.label}
            >
              <DrawingToolGlyph tool={tool.id} />
            </button>
          ))}
          {(() => {
            const showDrawControls =
              drawingTool === "Rectangle" ||
              drawingTool === "Gan" ||
              drawingTool === "TrendLine" ||
              drawingTool === "HorizontalRay" ||
              drawingTool === "Path" ||
              drawingTool === "Brush" ||
              selectedDrawingTool === "Rectangle" ||
              selectedDrawingTool === "Gan" ||
              selectedDrawingTool === "TrendLine" ||
              selectedDrawingTool === "HorizontalRay" ||
              selectedDrawingTool === "Path" ||
              selectedDrawingTool === "Brush";
            const showCalloutControls = drawingTool === "Callout" || selectedDrawingTool === "Callout";
            const showLotsControls = drawingTool === "LongShortPosition" || selectedDrawingTool === "LongShortPosition";
            return (
              <>
                <label className="flex h-7 items-center gap-2 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={continuousDrawingEnabled}
                    onChange={(event) => setContinuousDrawingEnabled(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span className="whitespace-nowrap font-medium">CD</span>
                </label>
                <div className={`h-7 items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${showDrawControls ? "flex opacity-100" : "hidden pointer-events-none opacity-0"}`} aria-hidden={!showDrawControls}>
             
                  <input type="color" aria-label="Draw color" value={rectangleFillColor} onChange={(event) => setRectangleFillColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" />
                  <input type="range" aria-label="Draw opacity" min={0} max={1} step={0.05} value={rectangleFillOpacity} onChange={(event) => setRectangleFillOpacity(Number(event.target.value))} className="h-1.5 w-14 accent-foreground" />
                </div>
                <div className={`h-7 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${showLotsControls ? "flex opacity-100" : "hidden pointer-events-none opacity-0"}`} aria-hidden={!showLotsControls}>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Lots</span>
                  <input type="number" inputMode="decimal" min={0.01} step={0.01} value={Number.isFinite(longShortLots) ? longShortLots : 1} onChange={(event) => setLongShortLots(Number(event.target.value))} className="h-5 w-14 rounded border border-border bg-background px-1.5 text-[10px] text-foreground" />
                </div>
                <div className={`h-7 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${showCalloutControls ? "flex opacity-100" : "hidden pointer-events-none opacity-0"}`} aria-hidden={!showCalloutControls}>
                  <textarea ref={calloutTextInputRef} value={calloutText} onChange={(event) => setCalloutText(event.target.value)} onKeyDown={handleCalloutTextKeyDown} placeholder="Text" rows={1} className="h-7 w-28 resize-none rounded border border-border bg-background px-1.5 py-1 text-[10px] leading-[1.2] text-foreground" />
                  <input type="color" value={calloutTextColor} onChange={(event) => setCalloutTextColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Text color" />
                  <input type="color" value={calloutLineColor} onChange={(event) => setCalloutLineColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Line and border color" />
                  <input type="color" value={calloutBoxColor} onChange={(event) => setCalloutBoxColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Box color" />
                  <input type="number" min={10} max={48} step={1} value={calloutFontSize} onChange={(event) => setCalloutFontSize(Math.max(10, Math.min(48, Number(event.target.value) || 18)))} className="h-5 w-12 rounded border border-border bg-background px-1 text-[10px] text-foreground" aria-label="Font size" />
                </div>
                {selectedDrawingTool ? (
                  <button
                    type="button"
                    onClick={deleteSelectedDrawings}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                    title="Delete selected drawing"
                    aria-label="Delete selected drawing"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </>
            );
          })()}
        </div>
      ) : (
        <div className="relative" ref={compactDrawRef}>
          <button
            type="button"
            onClick={() => {
              setCompactDrawOpen((o) => !o);
              closeCompactActions();
            }}
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
                <label className="mt-1 flex items-center gap-2 rounded-md px-1 py-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={continuousDrawingEnabled}
                    onChange={(event) => setContinuousDrawingEnabled(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
           <span>CD</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {compact && (() => {
        const showDrawControls =
          drawingTool === "Rectangle" ||
          drawingTool === "Gan" ||
          drawingTool === "TrendLine" ||
          drawingTool === "HorizontalRay" ||
          drawingTool === "Path" ||
          drawingTool === "Brush" ||
          selectedDrawingTool === "Rectangle" ||
          selectedDrawingTool === "Gan" ||
          selectedDrawingTool === "TrendLine" ||
          selectedDrawingTool === "HorizontalRay" ||
          selectedDrawingTool === "Path" ||
          selectedDrawingTool === "Brush";
        const showCalloutControls = drawingTool === "Callout" || selectedDrawingTool === "Callout";
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
              <div className="flex h-7 items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <span className="text-[9px] font-medium uppercase text-muted-foreground">Lots</span>
                <input type="number" inputMode="decimal" min={0.01} step={0.01} value={Number.isFinite(longShortLots) ? longShortLots : 1} onChange={(event) => setLongShortLots(Number(event.target.value))} className="h-5 w-16 rounded border border-border bg-background px-1 text-[10px] text-foreground" />
              </div>
            )}
            {showCalloutControls && (
              <div className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <textarea ref={calloutTextInputRef} value={calloutText} onChange={(event) => setCalloutText(event.target.value)} onKeyDown={handleCalloutTextKeyDown} placeholder="Text" rows={1} className="h-7 w-24 resize-none rounded border border-border bg-background px-1 py-1 text-[10px] leading-[1.2] text-foreground" />
                <input type="color" value={calloutTextColor} onChange={(event) => setCalloutTextColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Text color" />
                <input type="color" value={calloutLineColor} onChange={(event) => setCalloutLineColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Line and border color" />
                <input type="color" value={calloutBoxColor} onChange={(event) => setCalloutBoxColor(event.target.value)} className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Box color" />
                <input type="number" min={10} max={48} step={1} value={calloutFontSize} onChange={(event) => setCalloutFontSize(Math.max(10, Math.min(48, Number(event.target.value) || 18)))} className="h-5 w-12 rounded border border-border bg-background px-1 text-[10px] text-foreground" aria-label="Font size" />
              </div>
            )}
            {selectedDrawingTool ? (
              <button
                type="button"
                onClick={deleteSelectedDrawings}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                title="Delete selected drawing"
                aria-label="Delete selected drawing"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </>
        );
      })()}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2 max-[480px]:ml-0">
        <button
          type="button"
          onClick={() => {
            refreshCurrentView();
            closeCompactActions();
          }}
          disabled={!selectedTimeframe || isBarsLoading || isEdgeLoading}
          className="flex h-7 w-7 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
          title="Refresh chart"
          aria-label="Refresh chart"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isBarsLoading || isEdgeLoading ? "animate-spin" : ""}`} />
        </button>
        <div
          ref={compactActionsRef}
          className="relative"
          onMouseEnter={() => setCompactActionsOpen(true)}
          onMouseLeave={() => {
            if (!compactActionsPinned) {
              setCompactActionsOpen(false);
            }
          }}
          onFocusCapture={() => setCompactActionsOpen(true)}
          onBlurCapture={(event) => {
            if (
              !compactActionsPinned &&
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setCompactActionsOpen(false);
            }
          }}
        >
          <button
            type="button"
            onClick={() => {
              if (compactActionsPinned) {
                closeCompactActions();
                return;
              }
              setCompactActionsOpen(true);
              setCompactActionsPinned(true);
              setCompactDrawOpen(false);
            }}
            className={`flex h-7 w-7 items-center justify-center rounded border transition-colors ${
              compactActionsOpen ? "border-primary/60 bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"
            }`}
            title="More actions"
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={compactActionsOpen}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
          {compactActionsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 min-w-[170px] rounded-md border border-border bg-popover py-1 shadow-xl">
            <button
              type="button"
              onClick={() => {
                setIsExpanded((prev) => !prev);
                closeCompactActions();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent"
            >
              {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              {isExpanded ? "Exit Full Screen" : "Full Screen"}
            </button>
            <button
              type="button"
              onClick={() => {
                chartRef.current?.fitContent();
                closeCompactActions();
              }}
              disabled={!selectedTimeframe}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Maximize2 className="h-3 w-3" />
              Fit Chart
            </button>
            <button
              type="button"
              onClick={() => {
                toggleDrawingsHidden();
                closeCompactActions();
              }}
              disabled={!selectedTimeframe}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {drawingsHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              {drawingsHidden ? "Show Drawings" : "Hide Drawings"}
            </button>
            <button
              type="button"
              onClick={() => {
                chartRef.current?.removeAllDrawingTools();
                setDrawingTool(null);
                setSelectedDrawingTool(null);
                setDrawingsHidden(false);
                closeCompactActions();
              }}
              disabled={!selectedTimeframe}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              <Eraser className="h-3 w-3" />
              Clear Drawings
            </button>
            <button
              type="button"
              onClick={() => {
                onTogglePageTabsVisibility?.();
                closeCompactActions();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent"
            >
              {arePageTabsVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              {arePageTabsVisible ? "Hide Header" : "Show Header"}
            </button>
            </div>
          )}
        </div>
      </div>
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
          data={displayBars}
          replayRightOffsetBars={isReplayMode ? REPLAY_RIGHT_OFFSET_BARS : 0}
          timeframe={timeframe}
          timeGuides={timeGuides}
          clipTimeGuideOverlayToPane
          dataUpdateMode={isReplayMode ? replayDataUpdateMode : chartUpdateMode}
          trade={viewerTrade}
          height={isExpanded ? expandedHeight : chartAreaHeight}
          isLoading={isBarsLoading}
          drawingTool={drawingTool}
          continuousDrawing={continuousDrawingEnabled}
          drawingsHidden={drawingsHidden}
          drawingLineColor={rectangleFillColor}
          rectangleFillColor={drawingFillRgba}
          rectangleBorderColor={rectangleFillColor}
          calloutText={calloutText}
          calloutFontSize={calloutFontSize}
          calloutTextColor={calloutTextColor}
          calloutLineColor={calloutLineColor}
          calloutBoxColor={calloutBoxColor}
          onDrawingSelectionChange={setSelectedDrawingTool}
          onDrawingToolComplete={() => {
            if (!continuousDrawingEnabled) {
              setDrawingTool(null);
            }
          }}
          onDrawingToolCancel={() => {
            setDrawingTool(null);
            setSelectedDrawingTool(null);
          }}
          onCalloutEditRequest={() => {
            window.setTimeout(() => {
              calloutTextInputRef.current?.focus();
              calloutTextInputRef.current?.select();
            }, 0);
          }}
          replayPlacementMode={isReplayPlacementMode}
          replayPlacementTimestamp={replayPlacementTimestamp}
          onReplayPlacementPreviewChange={setReplayPlacementTimestamp}
          onReplayPlacementSelect={startReplayAtTimestamp}
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
