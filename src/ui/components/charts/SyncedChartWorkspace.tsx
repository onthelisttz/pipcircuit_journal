"use client";

import {
  addMonths,
  endOfMonth,
  format,
  isSameDay,
  startOfMonth,
} from "date-fns";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Calendar,
  RefreshCw,
  Eraser,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock3,
  AlertTriangle,
  Bell,
  Circle,
  Maximize2,
  Minimize2,
  Pause,
  Pencil,
  Play,
  MoreVertical,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { Direction, OrderType } from "@domain/enums";
import { TradeCandlestickChart } from "@ui/components/charts";
import type { DrawingToolType, TradeCandlestickChartRef } from "@ui/components/charts/TradeCandlestickChart";
import type { ChartTradeHistoryPanelData } from "./ChartTradeHistoryPanel";
type DrawingToolExport = ReturnType<TradeCandlestickChartRef["exportAllDrawings"]>[number];
import { useChartData } from "@ui/hooks/useChartData";
import {
  useCTraderLiveBar,
  type LiveOrderSnapshot,
  type LivePositionSnapshot,
} from "@ui/hooks/useCTraderLiveBar";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { useTradesByQuery } from "@ui/hooks/useTradesByQuery";
import { useAccount } from "@ui/hooks/useAccount";
import { useAuth } from "@ui/hooks/useAuth";
import {
  usePriceAlerts,
  type PriceAlertCondition,
  type PriceAlertEvent,
  type PriceAlertPriceSide,
} from "@ui/hooks/usePriceAlerts";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { TokenStorage } from "@infrastructure/auth";
import { hexToRgba } from "@lib/color";
import { buildLocalServiceEndpoint } from "@lib/ctrader-live";
import { priceDiffToPips } from "@lib/pnl-estimate";
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

const CHART_SELECTION_KEY = "chartSelection";
const CHART_TIMEFRAME_KEY = "chartTimeframe";
const CHART_TIME_GUIDES_KEY = "chartTimeGuides_synced";
const CHART_SHOW_TRADES_OVERLAY_KEY = "chartShowTrades_synced";
const CHART_SHOW_TRADES_PANEL_KEY = "chartShowTradesPanel_synced";
const CHART_SHOW_LIVE_TRADES_ON_CHART_KEY = "chartShowLiveTradesOnChart_v1";
const CHART_CONTINUOUS_DRAWING_KEY = "chartContinuousDrawingEnabled_v1";
const CHART_LIVE_MODE_KEY = "chartLiveModeEnabled_v1";
const CHART_SHOW_ALERTS_ON_CHART_KEY = "chartShowAlertsOnChart_v1";
const SYNCED_CHART_DRAWINGS_STORAGE_PREFIX = "syncedChartDrawings_v1";
const CHART_NOTICE_DISMISS_MS = 10_000;
const SYNCED_CHART_DISPLAY_OFFSET_MS = 3 * 60 * 60 * 1000;
const ALERT_SOUND_PATH = "/sounds/price-alert-reached.wav";
type ChartSelection = { broker: string; symbol: string };
type StoredSyncedDrawingSnapshot = {
  drawings: DrawingToolExport[];
  centerTimestamp: number | null;
  windowSeconds: number | null;
  savedAt: number;
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

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "H1"];
const TIMEFRAME_MIN_RESTORE_WINDOW_SECONDS: Partial<Record<ChartTimeframe, number>> = {
  M1: 3 * 60 * 60,
  M5: 12 * 60 * 60,
  M15: 2 * 24 * 60 * 60,
  H1: 10 * 24 * 60 * 60,
};
const EDGE_FETCH_THRESHOLD = 10;
const FETCH_THROTTLE_MS = 160;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type LiveOrderType = "MARKET" | "LIMIT" | "STOP";
type LiveTradeRequestResponse = {
  execution?: {
    positionId?: number | null;
    orderId?: number | null;
  } | null;
  positions?: LivePositionSnapshot[];
  orders?: LiveOrderSnapshot[];
  error?: string;
};

function ChartNotice({
  tone,
  onClose,
  children,
}: {
  tone: "error" | "warning" | "success";
  onClose: () => void;
  children: ReactNode;
}) {
  const toneClassName =
    tone === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "border-destructive/40 bg-destructive/10 text-destructive";

  return (
    <div className={`mt-3 flex items-start justify-between gap-3 rounded-lg border p-3 text-xs ${toneClassName}`}>
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-current/80 transition-colors hover:bg-black/10 hover:text-current dark:hover:bg-white/10"
        aria-label="Close message"
        title="Close"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

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

function inferDisplayDecimals(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price)) return 5;
  if (price >= 100000) return 0;
  if (price >= 10000) return 1;
  if (price >= 1000) return 2;
  if (price >= 100) return 3;
  return 5;
}

function formatLivePrice(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "--";
  const decimals = inferDisplayDecimals(value);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatLivePriceInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(inferDisplayDecimals(value));
}

function normalizeTradeSymbol(symbol?: string | null): string {
  return (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function getDefaultChartLots(symbol?: string | null): number {
  const normalized = normalizeTradeSymbol(symbol);
  if (normalized === "GBPUSD" || normalized === "GU") {
    return 0.05;
  }
  return 0.1;
}

function getPipStep(symbol?: string | null): number {
  const pipsPerWholeUnit = priceDiffToPips(1, symbol ?? "");
  if (!Number.isFinite(pipsPerWholeUnit) || pipsPerWholeUnit === 0) {
    return 0.0001;
  }
  return 1 / Math.abs(pipsPerWholeUnit);
}

function formatPipsInput(value: number): string {
  if (!Number.isFinite(value)) return "";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function formatAlertConditionLabel(condition: PriceAlertCondition): string {
  return condition === "below" ? "Crosses Below" : "Crosses Above";
}

function deriveAlertCondition(targetPrice: number, referencePrice: number | null | undefined): PriceAlertCondition {
  if (referencePrice == null || !Number.isFinite(referencePrice)) {
    return "above";
  }
  return targetPrice >= referencePrice ? "above" : "below";
}

function parseOptionalNumberInput(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeTradeActionMessage(message: string): string {
  if (message.includes("TRADE permission required")) {
    return "cTrader trading permission is missing. Re-link your cTrader account and approve trading access.";
  }
  return message;
}

function buildMonthDays(month: Date): Date[] {
  const start = startOfMonth(month);
  const end = endOfMonth(month);
  const days: Date[] = [];

  for (let day = start.getDate(); day <= end.getDate(); day += 1) {
    days.push(new Date(start.getFullYear(), start.getMonth(), day));
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

function SingleDatePopover({
  value,
  min,
  max,
  onClose,
  onApply,
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
    <div className="fixed inset-x-2 bottom-2 top-16 z-30 overflow-y-auto rounded-xl border border-border bg-popover p-3 shadow-2xl animate-in fade-in-0 zoom-in-95 sm:absolute sm:left-0 sm:top-full sm:mt-2 sm:w-[320px] sm:max-w-[calc(100vw-2rem)] sm:inset-auto sm:p-4">
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
          htmlFor="synced-chart-go-to-date-input"
          className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          Go to date
        </label>
        <input
          id="synced-chart-go-to-date-input"
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
          aria-describedby="synced-chart-go-to-date-help"
        />
        <p
          id="synced-chart-go-to-date-help"
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
          onClick={() => onApply(tempDate)}
          disabled={!isApplyEnabled || Boolean(dateInputError)}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

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

function readStoredShowTrades(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHART_SHOW_TRADES_OVERLAY_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredShowTradePanel(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storedPanelValue = window.localStorage.getItem(CHART_SHOW_TRADES_PANEL_KEY);
    if (storedPanelValue == null) {
      return window.localStorage.getItem(CHART_SHOW_TRADES_OVERLAY_KEY) === "true";
    }
    return storedPanelValue === "true";
  } catch {
    return false;
  }
}

function readStoredShowLiveTradesOnChart(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const storedValue = window.localStorage.getItem(CHART_SHOW_LIVE_TRADES_ON_CHART_KEY);
    return storedValue == null ? true : storedValue === "true";
  } catch {
    return true;
  }
}

function readStoredLiveMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHART_LIVE_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

function readStoredShowAlertsOnChart(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const storedValue = window.localStorage.getItem(CHART_SHOW_ALERTS_ON_CHART_KEY);
    return storedValue == null ? true : storedValue === "true";
  } catch {
    return true;
  }
}

function buildSyncedDrawingStorageKey(
  broker?: string | null,
  symbol?: string | null,
  timeframe?: ChartTimeframe | null
): string | null {
  if (!broker || !symbol || !timeframe) return null;
  return `${SYNCED_CHART_DRAWINGS_STORAGE_PREFIX}:${broker.toUpperCase()}:${symbol.toUpperCase()}:${timeframe}`;
}

function readStoredSyncedDrawingSnapshot(
  broker?: string | null,
  symbol?: string | null,
  timeframe?: ChartTimeframe | null
): StoredSyncedDrawingSnapshot | null {
  if (typeof window === "undefined") return null;
  const storageKey = buildSyncedDrawingStorageKey(broker, symbol, timeframe);
  if (!storageKey) return null;

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<StoredSyncedDrawingSnapshot>;
    return {
      drawings: Array.isArray(parsed.drawings) ? parsed.drawings : [],
      centerTimestamp:
        typeof parsed.centerTimestamp === "number" &&
        Number.isFinite(parsed.centerTimestamp)
          ? parsed.centerTimestamp
          : null,
      windowSeconds:
        typeof parsed.windowSeconds === "number" &&
        Number.isFinite(parsed.windowSeconds) &&
        parsed.windowSeconds > 0
          ? parsed.windowSeconds
          : null,
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : 0,
    };
  } catch {
    return null;
  }
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

function getDrawingWindowDays(
  centerTimestamp: number | null,
  drawings: DrawingToolExport[]
): number {
  if (centerTimestamp == null || drawings.length === 0) return 0;

    let maxDistance = 0;
  for (const drawing of drawings) {
    for (const point of drawing.points) {
      if (!Number.isFinite(point.timestamp)) continue;
      const distance = Math.abs(drawingTimestampToMs(point.timestamp) - centerTimestamp);
      maxDistance = Math.max(maxDistance, distance);
    }
  }

  return maxDistance > 0 ? Math.ceil(maxDistance / DAY_MS) + 1 : 0;
}

function areDrawingsCoveredByBars(
  drawings: DrawingToolExport[],
  bars: ChartBar[]
): boolean {
  if (drawings.length === 0 || bars.length === 0) return true;

  const loadedFrom = bars[0].timestamp;
  const loadedTo = bars[bars.length - 1].timestamp;

  return drawings.every((drawing) =>
    drawing.points.every((point) => {
      const timestamp = drawingTimestampToMs(point.timestamp);
      return timestamp >= loadedFrom && timestamp <= loadedTo;
    })
  );
}

interface SyncedChartWorkspaceProps {
  initialSymbol?: string;
  initialBroker?: string;
  initialTimeframe?: ChartTimeframe;
  initialGoToDate?: string;
  onSymbolChange?: (symbol: string, broker: string) => void;
  onTimeframeChange?: (timeframe: string) => void;
  onGoToDateChange?: (goToDate?: string) => void;
  onObservationApiChange?: (api: ChartObservationWorkspaceApi | null) => void;
  observationLoadRequest?: ChartObservationLoadRequest | null;
  onObservationLoadHandled?: (requestId: string) => void;
  isActive?: boolean;
  onTradePanelChange?: (panel: ChartTradeHistoryPanelData | null) => void;
  keepLiveSessionWarm?: boolean;
  arePageTabsVisible?: boolean;
  onTogglePageTabsVisibility?: () => void;
  onHeaderControlsChange?: (controls: ReactNode | null) => void;
  /** Hide drawing tools & action buttons for compact multi-pane layouts */
  compact?: boolean;
}

export function SyncedChartWorkspace({
  initialSymbol,
  initialBroker,
  initialTimeframe,
  initialGoToDate,
  onSymbolChange,
  onTimeframeChange,
  onGoToDateChange,
  onObservationApiChange,
  observationLoadRequest,
  onObservationLoadHandled,
  isActive = true,
  onTradePanelChange,
  keepLiveSessionWarm = false,
  arePageTabsVisible = true,
  onTogglePageTabsVisibility,
  onHeaderControlsChange,
  compact = false,
}: SyncedChartWorkspaceProps = {}) {
  const { activeAccount, accounts, syncTradesForAccount } = useAccount();
  const { user, session } = useAuth();
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
    initialTimeframe && TIMEFRAMES.includes(initialTimeframe)
      ? initialTimeframe
      : readStoredTimeframe()
  );
  const [goToDate, setGoToDate] = useState(initialGoToDate ?? "");
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [focusTimestamp, setFocusTimestamp] = useState<number | null>(() => {
    const parsed = fromDateInputValue(initialGoToDate ?? "");
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
  const [continuousDrawingEnabled, setContinuousDrawingEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(CHART_CONTINUOUS_DRAWING_KEY) === "true";
  });
  const [rectangleFillColor, setRectangleFillColor] = useState("#00ff66");
  const [rectangleFillOpacity, setRectangleFillOpacity] = useState(0.2);
  const [selectedDrawingTool, setSelectedDrawingTool] = useState<DrawingToolType | null>(null);
  const [calloutText, setCalloutText] = useState("Text");
  const [calloutFontSize, setCalloutFontSize] = useState(18);
  const [calloutTextColor, setCalloutTextColor] = useState("#00ff66");
  const [calloutLineColor, setCalloutLineColor] = useState("#00ff66");
  const [calloutBoxColor, setCalloutBoxColor] = useState("rgba(0,0,0,0.88)");
  const [longShortLots, setLongShortLots] = useState(0.1);
  const [showTradeOverlay, setShowTradeOverlay] = useState(() => readStoredShowTrades());
  const [showTradePanel, setShowTradePanel] = useState(() => readStoredShowTradePanel());
  const [showLiveTradesOnChart, setShowLiveTradesOnChart] = useState(() =>
    readStoredShowLiveTradesOnChart()
  );
  const [liveModeEnabled, setLiveModeEnabled] = useState(() => readStoredLiveMode());
  const [showAlertsOnChart, setShowAlertsOnChart] = useState(() => readStoredShowAlertsOnChart());
  const [livePositions, setLivePositions] = useState<LivePositionSnapshot[]>([]);
  const [liveOrders, setLiveOrders] = useState<LiveOrderSnapshot[]>([]);
  const [isAlertFormOpen, setIsAlertFormOpen] = useState(false);
  const [alertTargetPrice, setAlertTargetPrice] = useState("");
  const [alertCondition, setAlertCondition] = useState<PriceAlertCondition>("above");
  const [alertPriceSide, setAlertPriceSide] = useState<PriceAlertPriceSide>("bid");
  const [alertNote, setAlertNote] = useState("");
  const [alertActionPending, setAlertActionPending] = useState(false);
  const [alertActionError, setAlertActionError] = useState<string | null>(null);
  const [alertFlashEvent, setAlertFlashEvent] = useState<PriceAlertEvent | null>(null);
  const [tradeActionError, setTradeActionError] = useState<string | null>(null);
  const [tradeActionPending, setTradeActionPending] = useState(false);
  const [isRichTradeOpen, setIsRichTradeOpen] = useState(false);
  const [richTradeOrderType, setRichTradeOrderType] = useState<LiveOrderType>("MARKET");
  const [richTradeSide, setRichTradeSide] = useState<"BUY" | "SELL">("BUY");
  const [richTradePrice, setRichTradePrice] = useState("");
  const [richTradeStopLoss, setRichTradeStopLoss] = useState("");
  const [richTradeTakeProfit, setRichTradeTakeProfit] = useState("");
  const [richTradeStopLossPips, setRichTradeStopLossPips] = useState("");
  const [richTradeTakeProfitPips, setRichTradeTakeProfitPips] = useState("");
  const [richTradeComment, setRichTradeComment] = useState("");
  const [selectedTradeHistoryId, setSelectedTradeHistoryId] = useState<number | null>(null);
  const [timeGuides, setTimeGuides] = useState<TimeGuideSettings>(() =>
    readStoredTimeGuideSettings(CHART_TIME_GUIDES_KEY)
  );
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplayPlacementMode, setIsReplayPlacementMode] = useState(false);
  const [isReplayPlaying, setIsReplayPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [replayStartIndex, setReplayStartIndex] = useState<number | null>(null);
  const [replayCursorTimestamp, setReplayCursorTimestamp] = useState<number | null>(null);
  const [replayStartTimestamp, setReplayStartTimestamp] = useState<number | null>(null);
  const [replayIntervalMs, setReplayIntervalMs] = useState<number>(DEFAULT_REPLAY_INTERVAL_MS);
  const [replayPlacementTimestamp, setReplayPlacementTimestamp] = useState<number | null>(null);
  const [symbolMenuOpen, setSymbolMenuOpen] = useState(false);
  const [timeframeMenuOpen, setTimeframeMenuOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedHeight, setExpandedHeight] = useState(640);
  const lastPrevFetchRef = useRef(0);
  const lastNextFetchRef = useRef(0);
  const fetchingPrevRef = useRef(false);
  const fetchingNextRef = useRef(false);
  const pendingPrevFetchRef = useRef(false);
  const pendingNextFetchRef = useRef(false);
  const lastVisibleRangeRef = useRef<{ from: number; to: number } | null>(null);
  const chartRef = useRef<TradeCandlestickChartRef | null>(null);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const pendingGoToTimestampRef = useRef<number | null>(null);
  const symbolButtonRef = useRef<HTMLButtonElement>(null);
  const symbolMenuRef = useRef<HTMLDivElement>(null);
  const timeframeButtonRef = useRef<HTMLButtonElement>(null);
  const timeframeMenuRef = useRef<HTMLDivElement>(null);
  const tradesButtonRef = useRef<HTMLButtonElement>(null);
  const tradesMenuRef = useRef<HTMLDivElement>(null);
  const richTradeButtonRef = useRef<HTMLButtonElement>(null);
  const richTradePopupRef = useRef<HTMLDivElement | null>(null);
  const alertSoundRef = useRef<HTMLAudioElement | null>(null);
  const alertSoundUnlockedRef = useRef(false);
  const lastAlertSyncSignatureRef = useRef<string | null>(null);
  const [chartAreaHeight, setChartAreaHeight] = useState(520);
  const [compactDrawOpen, setCompactDrawOpen] = useState(false);
  const [compactActionsOpen, setCompactActionsOpen] = useState(false);
  const [tradesMenuOpen, setTradesMenuOpen] = useState(false);
  const [timeframeRestoreAnchor, setTimeframeRestoreAnchor] = useState<{
    centerTimestamp: number | null;
    windowDays: number;
  }>({
    centerTimestamp: null,
    windowDays: 0,
  });
  const compactDrawRef = useRef<HTMLDivElement>(null);
  const compactActionsRef = useRef<HTMLDivElement>(null);
  const replayTimerRef = useRef<number | null>(null);
  const pendingReplayViewportRef = useRef<{ from: number; to: number } | null>(null);
  const pendingRestoreRef = useRef<{
    drawings: DrawingToolExport[];
    centerTimestamp: number | null;
    windowSeconds?: number | null;
    preferLatestTimestamp?: boolean;
  } | null>(null);
  const lastHandledObservationRequestRef = useRef<string | null>(null);
  const skipNextCalloutApplyRef = useRef(false);
  const calloutTextInputRef = useRef<HTMLTextAreaElement>(null);
  const richTradeStopLossEditModeRef = useRef<"price" | "pips">("price");
  const richTradeTakeProfitEditModeRef = useRef<"price" | "pips">("price");
  const [dismissedChartErrorKey, setDismissedChartErrorKey] = useState<string | null>(null);
  const [dismissedLiveErrorKey, setDismissedLiveErrorKey] = useState<string | null>(null);
  const [dismissedPriceAlertsErrorKey, setDismissedPriceAlertsErrorKey] = useState<string | null>(null);
  const silentTradeSyncTimerRef = useRef<number | null>(null);
  const previousLivePositionIdsRef = useRef<string[]>([]);
  const restoredDrawingStorageKeyRef = useRef<string | null>(null);
  const currentDrawingStorageKey = useMemo(
    () => buildSyncedDrawingStorageKey(selection?.broker, selection?.symbol, timeframe),
    [selection?.broker, selection?.symbol, timeframe]
  );
  const storedDrawingSnapshot = useMemo(
    () =>
      readStoredSyncedDrawingSnapshot(
        selection?.broker,
        selection?.symbol,
        timeframe
      ),
    [selection?.broker, selection?.symbol, timeframe]
  );
  const persistCurrentDrawings = useCallback(
    (storageKeyOverride?: string | null) => {
      if (typeof window === "undefined") return;
      const storageKey = storageKeyOverride ?? currentDrawingStorageKey;
      if (!storageKey) return;

      const snapshot: StoredSyncedDrawingSnapshot = {
        drawings: chartRef.current?.exportAllDrawings() ?? [],
        centerTimestamp: chartRef.current?.getViewportCenterTimestamp() ?? null,
        windowSeconds: chartRef.current?.getVisibleWindowSeconds() ?? null,
        savedAt: Date.now(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    },
    [currentDrawingStorageKey]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !selection) return;
    window.localStorage.setItem(CHART_SELECTION_KEY, JSON.stringify(selection));
  }, [selection]);

  useEffect(() => {
    setTimeframeRestoreAnchor({
      centerTimestamp: null,
      windowDays: 0,
    });
  }, [selection?.broker, selection?.symbol]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_TIMEFRAME_KEY, timeframe);
  }, [timeframe]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_TIME_GUIDES_KEY, JSON.stringify(timeGuides));
  }, [timeGuides]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CHART_CONTINUOUS_DRAWING_KEY,
      continuousDrawingEnabled ? "true" : "false"
    );
  }, [continuousDrawingEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_SHOW_TRADES_OVERLAY_KEY, String(showTradeOverlay));
  }, [showTradeOverlay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_SHOW_TRADES_PANEL_KEY, String(showTradePanel));
  }, [showTradePanel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      CHART_SHOW_LIVE_TRADES_ON_CHART_KEY,
      String(showLiveTradesOnChart)
    );
  }, [showLiveTradesOnChart]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_LIVE_MODE_KEY, String(liveModeEnabled));
  }, [liveModeEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_SHOW_ALERTS_ON_CHART_KEY, String(showAlertsOnChart));
  }, [showAlertsOnChart]);

  useEffect(() => {
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setIsReplayPlacementMode(false);
    setReplayIndex(null);
    setReplayStartIndex(null);
    setReplayCursorTimestamp(null);
    setReplayStartTimestamp(null);
    setReplayPlacementTimestamp(null);
    pendingReplayViewportRef.current = null;
  }, [selection?.broker, selection?.symbol, timeframe]);

  useEffect(() => {
    return () => {
      if (replayTimerRef.current != null) {
        window.clearTimeout(replayTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showTradeOverlay && !showTradePanel) {
      setSelectedTradeHistoryId(null);
    }
  }, [showTradeOverlay, showTradePanel]);

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

  const handleCalloutTextKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter") return;
      if (event.shiftKey) return;
      event.preventDefault();
      event.currentTarget.blur();
    },
    []
  );

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
    onGoToDateChange?.(goToDate || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToDate]);

  const observationApi = useMemo<ChartObservationWorkspaceApi>(
    () => ({
      workspaceMode: "synced",
      symbol: selection?.symbol ?? null,
      broker: selection?.broker ?? null,
      timeframe,
      captureObservationContext: () => {
        const centerTimestamp = chartRef.current?.getViewportCenterTimestamp() ?? null;
        const windowSeconds = chartRef.current?.getVisibleWindowSeconds() ?? null;
        const drawings = filterDrawingsToVisibleWindow(
          chartRef.current?.exportAllDrawings() ?? [],
          centerTimestamp,
          windowSeconds
        );

        return {
          workspaceMode: "synced",
          broker: selection?.broker ?? null,
          symbol: selection?.symbol ?? null,
          timeframe,
          centerTimestamp,
          windowSeconds,
          drawings,
        };
      },
    }),
    [selection?.broker, selection?.symbol, timeframe]
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

    persistCurrentDrawings();
    setIsReplayPlaying(false);
    setIsReplayPlacementMode(false);
    chartRef.current?.cancelActiveDrawing();
    setDrawingTool(null);
    setSelectedDrawingTool(null);
    setCompactDrawOpen(false);
  }, [isActive, persistCurrentDrawings]);

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
    if (!tradesMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !tradesMenuRef.current?.contains(target) &&
        !tradesButtonRef.current?.contains(target)
      ) {
        setTradesMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTradesMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [tradesMenuOpen]);

  useEffect(() => {
    if (!isDatePickerOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!datePickerRef.current?.contains(target)) {
        setIsDatePickerOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsDatePickerOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isDatePickerOpen]);

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
      if (key === "b") {
        event.preventDefault();
        toggleTool("Brush");
      }
      if (key === "h") {
        event.preventDefault();
        toggleTool("HorizontalRay");
      }
      if (key === "p") {
        event.preventDefault();
        toggleTool("Path");
      }
      if (key === "x" || key === "m") {
        event.preventDefault();
        toggleTool("Callout");
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
    const storageKey = currentDrawingStorageKey;
    return () => {
      persistCurrentDrawings(storageKey);
    };
  }, [currentDrawingStorageKey, persistCurrentDrawings]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePageHide = () => {
      persistCurrentDrawings();
    };

    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [persistCurrentDrawings]);

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
    if (!activeAccount) return null;
    if (activeAccount.platform.toLowerCase() !== "ctrader") return null;
    if (!selection) return activeAccount;
    return activeAccount.broker === selection.broker ? activeAccount : null;
  }, [activeAccount, selection]);
  const brokerAccountNumbers = useMemo(() => {
    if (!selection || !accountForBroker) return [];
    return [accountForBroker.accountNumber];
  }, [accountForBroker, selection]);
  const availableDateRange = useMemo(() => {
    if (!selectedProgress?.firstBarDate || !selectedProgress?.lastBarDate) {
      return null;
    }

    const from =
      new Date(selectedProgress.firstBarDate).getTime() + SYNCED_CHART_DISPLAY_OFFSET_MS;
    const to =
      new Date(selectedProgress.lastBarDate).getTime() + SYNCED_CHART_DISPLAY_OFFSET_MS;

    return from <= to ? { from, to } : null;
  }, [selectedProgress?.firstBarDate, selectedProgress?.lastBarDate]);
  const storedDrawingRestoreCenterTimestamp =
    storedDrawingSnapshot?.centerTimestamp ?? null;
  const effectiveRestoreCenterTimestamp =
    timeframeRestoreAnchor.centerTimestamp ?? storedDrawingRestoreCenterTimestamp;
  const storedDrawingWindowDays = useMemo(
    () =>
      getDrawingWindowDays(
        storedDrawingRestoreCenterTimestamp,
        storedDrawingSnapshot?.drawings ?? []
      ),
    [storedDrawingRestoreCenterTimestamp, storedDrawingSnapshot?.drawings]
  );

  const chartTrade = useMemo<Trade | null>(() => {
    if (!selection) return null;
    const anchor =
      effectiveRestoreCenterTimestamp != null
        ? new Date(effectiveRestoreCenterTimestamp - SYNCED_CHART_DISPLAY_OFFSET_MS)
        : liveModeEnabled
          ? selectedProgress?.lastBarDate
            ? new Date(selectedProgress.lastBarDate)
            : new Date()
          : focusTimestamp != null
            ? new Date(focusTimestamp - SYNCED_CHART_DISPLAY_OFFSET_MS)
            : selectedProgress?.lastBarDate
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
  }, [
    accountForBroker,
    effectiveRestoreCenterTimestamp,
    focusTimestamp,
    liveModeEnabled,
    selection,
    selectedProgress,
  ]);

  const accessToken = useMemo(() => {
    if (!accountForBroker) return undefined;
    return TokenStorage.getGlobal()?.accessToken;
  }, [accountForBroker]);
  const liveAccountNumber = accountForBroker?.accountNumber ?? null;
  const liveVisualsEnabled =
    liveModeEnabled && !isReplayMode && !isReplayPlacementMode;

  const chartEnabled = Boolean(selection && chartTrade);
  const requestedWindowDays = Math.max(
    windowDays,
    timeframeRestoreAnchor.windowDays,
    storedDrawingWindowDays
  );
  const tradeFeaturesEnabled = showTradeOverlay || showTradePanel;
  const tradeHistoryQuery = useMemo(
    () => (tradeFeaturesEnabled && selection ? { symbol: selection.symbol } : null),
    [selection, tradeFeaturesEnabled]
  );
  const { trades: symbolTrades } = useTradesByQuery(tradeHistoryQuery);

  const { data, dataUpdateMode, isLoading, error, refetch, fetchPrevious, fetchNext } = useChartData({
    trade: chartTrade ?? PLACEHOLDER_TRADE,
    timeframe,
    accessToken,
    broker: selection?.broker,
    windowDays: requestedWindowDays,
    enabled: chartEnabled,
  });
  const {
    currentBar: liveCurrentBar,
    quote: liveQuote,
    positions: streamedLivePositions,
    orders: streamedLiveOrders,
    status: liveStatus,
    error: liveError,
    backfillCompletedAt,
    sessionId: liveSessionId,
    serviceUrl: liveServiceUrl,
  } = useCTraderLiveBar({
    enabled: liveVisualsEnabled && chartEnabled && (isActive || keepLiveSessionWarm),
    symbol: selection?.symbol,
    broker: selection?.broker,
    timeframe,
    accessToken,
    accountNumber: liveAccountNumber,
  });
  const {
    activeAlerts,
    recentEvents: recentAlertEvents,
    latestTriggeredEvent,
    error: priceAlertsError,
    createAlert,
    updateAlert,
    deleteAlert,
    clearLatestTriggeredEvent,
  } = usePriceAlerts({
    userId: user?.id,
    enabled: Boolean(user?.id && isActive),
  });
  useEffect(() => {
    if (!liveVisualsEnabled || backfillCompletedAt == null) return;
    void refetch();
  }, [backfillCompletedAt, liveVisualsEnabled, refetch]);
  useEffect(() => {
    if (!currentDrawingStorageKey) {
      restoredDrawingStorageKeyRef.current = null;
      return;
    }
    if (pendingRestoreRef.current) return;
    if (restoredDrawingStorageKeyRef.current === currentDrawingStorageKey) return;

    restoredDrawingStorageKeyRef.current = currentDrawingStorageKey;
    const snapshot = storedDrawingSnapshot;
    const restoreCenterTimestamp =
      snapshot?.centerTimestamp ??
      (liveVisualsEnabled ? availableDateRange?.to ?? null : null);

    pendingRestoreRef.current = {
      drawings: snapshot?.drawings ?? [],
      centerTimestamp: restoreCenterTimestamp,
      windowSeconds: snapshot?.windowSeconds ?? null,
      preferLatestTimestamp: false,
    };
    setTimeframeRestoreAnchor({
      centerTimestamp: restoreCenterTimestamp,
      windowDays: getDrawingWindowDays(
        restoreCenterTimestamp,
        snapshot?.drawings ?? []
      ),
    });
  }, [
    availableDateRange?.to,
    currentDrawingStorageKey,
    liveVisualsEnabled,
    storedDrawingSnapshot,
  ]);
  const liveMergedData = useMemo(() => {
    if (!liveVisualsEnabled || !liveCurrentBar) return data;

    const nextData = [...data];
    const lastBar = nextData[nextData.length - 1];

    if (!lastBar) {
      return [liveCurrentBar];
    }

    if (liveCurrentBar.timestamp < lastBar.timestamp) {
      return nextData;
    }

    if (liveCurrentBar.timestamp === lastBar.timestamp) {
      nextData[nextData.length - 1] = {
        ...lastBar,
        ...liveCurrentBar,
      };
      return nextData;
    }

    nextData.push(liveCurrentBar);
    return nextData;
  }, [data, liveCurrentBar, liveVisualsEnabled]);
  const liveDataUpdateMode = useMemo<"replace" | "append" | "prepend">(() => {
    if (!liveVisualsEnabled || !liveCurrentBar || data.length === 0) {
      return dataUpdateMode;
    }

    const lastBar = data[data.length - 1];
    if (!lastBar) return dataUpdateMode;

    return liveCurrentBar.timestamp >= lastBar.timestamp ? "append" : "replace";
  }, [data, dataUpdateMode, liveCurrentBar, liveVisualsEnabled]);
  const fullDisplayData = useMemo(
    () =>
      liveMergedData.map((bar) => ({
        ...bar,
        // cTrader bars arrive 3 hours behind the MT5 chart session the user expects.
        timestamp: bar.timestamp + SYNCED_CHART_DISPLAY_OFFSET_MS,
      })),
    [liveMergedData]
  );
  const effectiveReplayIndex = useMemo(() => {
    if (!isReplayMode || fullDisplayData.length === 0) {
      return null;
    }

    if (replayCursorTimestamp != null) {
      return findReplayStartIndex(fullDisplayData, replayCursorTimestamp);
    }

    if (replayIndex == null) {
      return null;
    }

    return clampReplayIndex(replayIndex, fullDisplayData.length);
  }, [fullDisplayData, isReplayMode, replayCursorTimestamp, replayIndex]);
  const displayData = useMemo(() => {
    if (effectiveReplayIndex == null) return fullDisplayData;
    return fullDisplayData.slice(0, effectiveReplayIndex + 1);
  }, [effectiveReplayIndex, fullDisplayData]);
  const replayFutureTimestamps = useMemo(() => {
    if (effectiveReplayIndex == null) return [];
    return fullDisplayData
      .slice(effectiveReplayIndex + 1)
      .map((bar) => bar.timestamp);
  }, [effectiveReplayIndex, fullDisplayData]);
  const displayDataRef = useRef(displayData);
  const replayCanStepBack = effectiveReplayIndex != null && effectiveReplayIndex > 0;
  const replayCanStepForward =
    effectiveReplayIndex != null && effectiveReplayIndex < fullDisplayData.length - 1;
  const brokerSymbolTrades = useMemo(() => {
    if (!tradeFeaturesEnabled || !selection || brokerAccountNumbers.length === 0) {
      return [];
    }

    return symbolTrades
      .filter((trade) => {
        return (
          trade.symbol === selection.symbol &&
          brokerAccountNumbers.includes(trade.accountId)
        );
      })
      .map((trade) => ({
        ...trade,
        openTime: new Date(new Date(trade.openTime).getTime() + SYNCED_CHART_DISPLAY_OFFSET_MS),
        closeTime: trade.closeTime
          ? new Date(new Date(trade.closeTime).getTime() + SYNCED_CHART_DISPLAY_OFFSET_MS)
          : trade.closeTime,
      }))
      .sort((left, right) => new Date(left.openTime).getTime() - new Date(right.openTime).getTime());
  }, [brokerAccountNumbers, selection, symbolTrades, tradeFeaturesEnabled]);

  const displayTradeHistory = useMemo(() => {
    if (!showTradeOverlay || brokerSymbolTrades.length === 0 || displayData.length === 0) {
      return [];
    }

    const visibleStart = displayData[0]?.timestamp ?? 0;
    const visibleEnd = displayData[displayData.length - 1]?.timestamp ?? 0;

    return brokerSymbolTrades.filter((trade) => {
      const openTime = new Date(trade.openTime).getTime();
      const closeTime = trade.closeTime
        ? new Date(trade.closeTime).getTime()
        : openTime;
      return closeTime >= visibleStart && openTime <= visibleEnd;
    });
  }, [brokerSymbolTrades, displayData, showTradeOverlay]);
  const symbolPriceAlerts = useMemo(() => {
    if (!selection) return [];
    return activeAlerts.filter(
      (alert) =>
        alert.broker === selection.broker &&
        alert.symbol === selection.symbol
    );
  }, [activeAlerts, selection]);
  const symbolAlertEvents = useMemo(() => {
    if (!selection) return [];
    return recentAlertEvents.filter(
      (event) =>
        event.broker === selection.broker &&
        event.symbol === selection.symbol
    );
  }, [recentAlertEvents, selection]);
  const alertSyncPayload = useMemo(
    () =>
      symbolPriceAlerts
        .map((alert) => ({
          id: alert.id,
          broker: alert.broker,
          symbol: alert.symbol,
          condition: alert.condition,
          priceSide: alert.priceSide,
          targetPrice: alert.targetPrice,
          note: alert.note ?? null,
          isActive: alert.isActive,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    [symbolPriceAlerts]
  );
  const alertSyncSignature = useMemo(() => {
    if (!liveSessionId || !selection || !user?.id || !session?.accessToken) {
      return null;
    }

    return JSON.stringify({
      sessionId: liveSessionId,
      userId: user.id,
      broker: selection.broker,
      symbol: selection.symbol,
      accessToken: session.accessToken,
      alerts: alertSyncPayload,
    });
  }, [
    alertSyncPayload,
    liveSessionId,
    selection,
    session?.accessToken,
    user?.id,
  ]);
  const getAlertReferencePrice = useCallback((priceSide: PriceAlertPriceSide) => {
    if (priceSide === "ask") {
      return liveQuote?.ask ?? liveCurrentBar?.close ?? displayData[displayData.length - 1]?.close ?? null;
    }
    return liveQuote?.bid ?? liveCurrentBar?.close ?? displayData[displayData.length - 1]?.close ?? null;
  }, [displayData, liveCurrentBar?.close, liveQuote?.ask, liveQuote?.bid]);
  const deriveAlertConditionForSide = useCallback(
    (targetPrice: number, priceSide: PriceAlertPriceSide) =>
      deriveAlertCondition(targetPrice, getAlertReferencePrice(priceSide)),
    [getAlertReferencePrice]
  );
  const liveStatusLabel = useMemo(() => {
    if (!liveModeEnabled) return "Cached";
    if (isReplayMode || isReplayPlacementMode) return "Live Paused";
    if (liveStatus === "backfilling") return "Backfilling";
    if (liveStatus === "connecting") return "Connecting";
    if (liveStatus === "live") return "Live";
    if (liveStatus === "error") return "Live Error";
    return "Cached";
  }, [isReplayMode, isReplayPlacementMode, liveModeEnabled, liveStatus]);
  const liveStatusClassName = useMemo(() => {
    if (!liveModeEnabled) return "border-border text-muted-foreground";
    if (isReplayMode || isReplayPlacementMode) {
      return "border-border text-muted-foreground";
    }
    if (liveStatus === "live") return "border-emerald-500/40 text-emerald-500";
    if (liveStatus === "backfilling" || liveStatus === "connecting") {
      return "border-amber-500/40 text-amber-500";
    }
    if (liveStatus === "error") return "border-destructive/40 text-destructive";
    return "border-border text-muted-foreground";
  }, [isReplayMode, isReplayPlacementMode, liveModeEnabled, liveStatus]);
  const liveBidLabel = useMemo(
    () => formatLivePrice(liveQuote?.bid ?? liveCurrentBar?.close ?? null),
    [liveCurrentBar?.close, liveQuote?.bid]
  );
  const liveAskLabel = useMemo(
    () => formatLivePrice(liveQuote?.ask ?? liveCurrentBar?.close ?? null),
    [liveCurrentBar?.close, liveQuote?.ask]
  );
  const liveReferenceTradePrice = useMemo(
    () =>
      richTradeSide === "BUY"
        ? (liveQuote?.ask ?? liveCurrentBar?.close ?? null)
        : (liveQuote?.bid ?? liveCurrentBar?.close ?? null),
    [liveCurrentBar?.close, liveQuote?.ask, liveQuote?.bid, richTradeSide]
  );
  const liveReferenceTradePriceInput = useMemo(
    () => formatLivePriceInput(liveReferenceTradePrice),
    [liveReferenceTradePrice]
  );
  const defaultChartLots = useMemo(
    () => getDefaultChartLots(selection?.symbol),
    [selection?.symbol]
  );
  const resolvedLongShortLots = Number.isFinite(longShortLots) && longShortLots > 0
    ? longShortLots
    : defaultChartLots;
  const richTradeEntryPrice = useMemo(() => {
    if (richTradeOrderType === "MARKET") {
      return liveReferenceTradePrice;
    }

    const parsedPrice = parseOptionalNumberInput(richTradePrice);
    if (Number.isFinite(parsedPrice)) {
      return parsedPrice;
    }

    return liveReferenceTradePrice;
  }, [liveReferenceTradePrice, richTradeOrderType, richTradePrice]);
  const richTradePipStep = useMemo(
    () => getPipStep(selection?.symbol),
    [selection?.symbol]
  );
  const canTradeLive = Boolean(
    liveVisualsEnabled &&
      liveSessionId &&
      selection &&
      accessToken &&
      liveAccountNumber &&
      !isReplayMode &&
      !isReplayPlacementMode &&
      liveStatus !== "error"
  );

  useEffect(() => {
    setLongShortLots(getDefaultChartLots(selection?.symbol));
  }, [selection?.symbol]);

  useEffect(() => {
    const parsedTargetPrice = Number(alertTargetPrice);
    if (!Number.isFinite(parsedTargetPrice)) return;
    const nextCondition = deriveAlertConditionForSide(parsedTargetPrice, alertPriceSide);
    setAlertCondition((current) => (current === nextCondition ? current : nextCondition));
  }, [alertPriceSide, alertTargetPrice, deriveAlertConditionForSide]);

  useEffect(() => {
    if (typeof Audio === "undefined") return;
    const audio = new Audio(ALERT_SOUND_PATH);
    audio.preload = "auto";
    alertSoundRef.current = audio;
    audio.load();

    const unlockAudio = () => {
      if (alertSoundUnlockedRef.current) return;

      audio.muted = true;
      void audio.play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
          alertSoundUnlockedRef.current = true;
          window.removeEventListener("pointerdown", unlockAudio);
          window.removeEventListener("keydown", unlockAudio);
        })
        .catch(() => {
          audio.muted = false;
        });
    };

    window.addEventListener("pointerdown", unlockAudio);
    window.addEventListener("keydown", unlockAudio);

    return () => {
      audio.pause();
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
      alertSoundRef.current = null;
      alertSoundUnlockedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!latestTriggeredEvent) return;

    setAlertFlashEvent(latestTriggeredEvent);
    const audio = alertSoundRef.current;
    if (audio) {
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    }
    clearLatestTriggeredEvent();

    const timeoutId = window.setTimeout(() => {
      setAlertFlashEvent((current) =>
        current?.id === latestTriggeredEvent.id ? null : current
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [clearLatestTriggeredEvent, latestTriggeredEvent]);

  useEffect(() => {
    if (
      !liveSessionId ||
      !selection ||
      !user?.id ||
      !session?.accessToken
    ) {
      lastAlertSyncSignatureRef.current = null;
      return;
    }

    if (alertSyncSignature && lastAlertSyncSignatureRef.current === alertSyncSignature) {
      return;
    }

    lastAlertSyncSignatureRef.current = alertSyncSignature;

    void fetch(
      buildLocalServiceEndpoint("/api/ctrader/live/alerts/sync", liveServiceUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: liveSessionId,
          userId: user.id,
          supabaseAccessToken: session.accessToken,
          alerts: symbolPriceAlerts,
        }),
      }
    ).catch(() => {});
  }, [
    alertSyncSignature,
    liveServiceUrl,
    liveSessionId,
    selection,
    session?.accessToken,
    symbolPriceAlerts,
    user?.id,
  ]);

  useEffect(() => {
    if (!tradeActionError) return;

    const timeoutId = window.setTimeout(() => {
      setTradeActionError((current) =>
        current === tradeActionError ? null : current
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [tradeActionError]);

  useEffect(() => {
    if (!alertActionError) return;

    const timeoutId = window.setTimeout(() => {
      setAlertActionError((current) =>
        current === alertActionError ? null : current
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [alertActionError]);

  useEffect(() => {
    const nextKey = error?.message ?? null;
    if (!nextKey) {
      setDismissedChartErrorKey(null);
      return;
    }
    if (dismissedChartErrorKey && dismissedChartErrorKey !== nextKey) {
      setDismissedChartErrorKey(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDismissedChartErrorKey((current) =>
        current === nextKey ? current : nextKey
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dismissedChartErrorKey, error?.message]);

  useEffect(() => {
    const nextKey = liveError ?? null;
    if (!nextKey) {
      setDismissedLiveErrorKey(null);
      return;
    }
    if (dismissedLiveErrorKey && dismissedLiveErrorKey !== nextKey) {
      setDismissedLiveErrorKey(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDismissedLiveErrorKey((current) =>
        current === nextKey ? current : nextKey
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dismissedLiveErrorKey, liveError]);

  useEffect(() => {
    const nextKey = priceAlertsError ?? null;
    if (!nextKey) {
      setDismissedPriceAlertsErrorKey(null);
      return;
    }
    if (dismissedPriceAlertsErrorKey && dismissedPriceAlertsErrorKey !== nextKey) {
      setDismissedPriceAlertsErrorKey(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setDismissedPriceAlertsErrorKey((current) =>
        current === nextKey ? current : nextKey
      );
    }, CHART_NOTICE_DISMISS_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [dismissedPriceAlertsErrorKey, priceAlertsError]);

  const updateStopLossFromPrice = useCallback((priceText: string) => {
    richTradeStopLossEditModeRef.current = "price";
    setRichTradeStopLoss(priceText);

    const entryPrice = richTradeEntryPrice;
    const stopLossPrice = parseOptionalNumberInput(priceText);
    if (
      entryPrice == null ||
      !Number.isFinite(entryPrice) ||
      stopLossPrice == null ||
      !Number.isFinite(stopLossPrice)
    ) {
      setRichTradeStopLossPips("");
      return;
    }

    const pips = Math.abs(priceDiffToPips(stopLossPrice - entryPrice, selection?.symbol ?? ""));
    setRichTradeStopLossPips(formatPipsInput(pips));
  }, [richTradeEntryPrice, selection?.symbol]);

  const updateTakeProfitFromPrice = useCallback((priceText: string) => {
    richTradeTakeProfitEditModeRef.current = "price";
    setRichTradeTakeProfit(priceText);

    const entryPrice = richTradeEntryPrice;
    const takeProfitPrice = parseOptionalNumberInput(priceText);
    if (
      entryPrice == null ||
      !Number.isFinite(entryPrice) ||
      takeProfitPrice == null ||
      !Number.isFinite(takeProfitPrice)
    ) {
      setRichTradeTakeProfitPips("");
      return;
    }

    const pips = Math.abs(priceDiffToPips(takeProfitPrice - entryPrice, selection?.symbol ?? ""));
    setRichTradeTakeProfitPips(formatPipsInput(pips));
  }, [richTradeEntryPrice, selection?.symbol]);

  const updateStopLossFromPips = useCallback((pipsText: string) => {
    richTradeStopLossEditModeRef.current = "pips";
    setRichTradeStopLossPips(pipsText);

    const entryPrice = richTradeEntryPrice;
    const pips = parseOptionalNumberInput(pipsText);
    if (
      entryPrice == null ||
      !Number.isFinite(entryPrice) ||
      pips == null ||
      !Number.isFinite(pips)
    ) {
      setRichTradeStopLoss("");
      return;
    }

    const distance = Math.abs(pips) * richTradePipStep;
    const nextPrice =
      richTradeSide === "BUY"
        ? entryPrice - distance
        : entryPrice + distance;
    setRichTradeStopLoss(formatLivePriceInput(nextPrice));
  }, [richTradeEntryPrice, richTradePipStep, richTradeSide]);

  const updateTakeProfitFromPips = useCallback((pipsText: string) => {
    richTradeTakeProfitEditModeRef.current = "pips";
    setRichTradeTakeProfitPips(pipsText);

    const entryPrice = richTradeEntryPrice;
    const pips = parseOptionalNumberInput(pipsText);
    if (
      entryPrice == null ||
      !Number.isFinite(entryPrice) ||
      pips == null ||
      !Number.isFinite(pips)
    ) {
      setRichTradeTakeProfit("");
      return;
    }

    const distance = Math.abs(pips) * richTradePipStep;
    const nextPrice =
      richTradeSide === "BUY"
        ? entryPrice + distance
        : entryPrice - distance;
    setRichTradeTakeProfit(formatLivePriceInput(nextPrice));
  }, [richTradeEntryPrice, richTradePipStep, richTradeSide]);

  useEffect(() => {
    if (richTradeStopLossEditModeRef.current === "pips") {
      if (!richTradeStopLossPips.trim()) {
        setRichTradeStopLoss("");
        return;
      }
      updateStopLossFromPips(richTradeStopLossPips);
      return;
    }

    if (!richTradeStopLoss.trim()) {
      setRichTradeStopLossPips("");
      return;
    }
    updateStopLossFromPrice(richTradeStopLoss);
  }, [
    richTradeEntryPrice,
    richTradePipStep,
    richTradeSide,
    richTradeStopLoss,
    richTradeStopLossPips,
    updateStopLossFromPips,
    updateStopLossFromPrice,
  ]);

  useEffect(() => {
    if (richTradeTakeProfitEditModeRef.current === "pips") {
      if (!richTradeTakeProfitPips.trim()) {
        setRichTradeTakeProfit("");
        return;
      }
      updateTakeProfitFromPips(richTradeTakeProfitPips);
      return;
    }

    if (!richTradeTakeProfit.trim()) {
      setRichTradeTakeProfitPips("");
      return;
    }
    updateTakeProfitFromPrice(richTradeTakeProfit);
  }, [
    richTradeEntryPrice,
    richTradePipStep,
    richTradeSide,
    richTradeTakeProfit,
    richTradeTakeProfitPips,
    updateTakeProfitFromPips,
    updateTakeProfitFromPrice,
  ]);

  const seedRichTradePrice = useCallback((
    nextOrderType: LiveOrderType,
    nextSide: "BUY" | "SELL",
    options?: { force?: boolean }
  ) => {
    if (nextOrderType === "MARKET") {
      return;
    }

    const sourcePrice =
      nextSide === "BUY"
        ? (liveQuote?.ask ?? liveCurrentBar?.close ?? null)
        : (liveQuote?.bid ?? liveCurrentBar?.close ?? null);
    const nextValue = formatLivePriceInput(sourcePrice);
    if (!nextValue) return;

    setRichTradePrice((current) => {
      if (options?.force || !current.trim()) {
        return nextValue;
      }
      return current;
    });
  }, [liveCurrentBar?.close, liveQuote?.ask, liveQuote?.bid]);

  const submitTradeRequest = useCallback(async (body: Record<string, unknown>) => {
    if (!liveSessionId) {
      throw new Error("Live session is not ready.");
    }

    setTradeActionPending(true);
    setTradeActionError(null);
    try {
      const response = await fetch(
        buildLocalServiceEndpoint("/api/ctrader/live/orders", liveServiceUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: liveSessionId,
            ...body,
          }),
        }
      );
      const payload = (await response.json()) as LiveTradeRequestResponse;

      if (!response.ok) {
        throw new Error(
          normalizeTradeActionMessage(payload.error ?? `Trade request failed (${response.status})`)
        );
      }

      setLivePositions(Array.isArray(payload.positions) ? payload.positions : []);
      setLiveOrders(Array.isArray(payload.orders) ? payload.orders : []);
      setIsRichTradeOpen(false);
      setRichTradeComment("");
      return payload;
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? normalizeTradeActionMessage(submitError.message)
          : "Trade request failed.";
      setTradeActionError(message);
      throw new Error(message);
    } finally {
      setTradeActionPending(false);
    }
  }, [liveServiceUrl, liveSessionId]);

  const scheduleSilentTradeSync = useCallback(() => {
    if (!accountForBroker) return;

    if (silentTradeSyncTimerRef.current != null) {
      window.clearTimeout(silentTradeSyncTimerRef.current);
    }

    silentTradeSyncTimerRef.current = window.setTimeout(() => {
      silentTradeSyncTimerRef.current = null;
      void syncTradesForAccount(
        accountForBroker.accountNumber,
        accountForBroker.ctraderAccountId
      ).catch((syncError) => {
        console.warn("[SyncedChartWorkspace] Failed to sync closed trades silently:", syncError);
      });
    }, 1200);
  }, [accountForBroker, syncTradesForAccount]);

  const amendLivePosition = useCallback(async (positionId: string, stopLoss?: number | null, takeProfit?: number | null) => {
    if (!liveSessionId) {
      throw new Error("Live session is not ready.");
    }

    const previousPositions = livePositions;
    const previousOrders = liveOrders;
    setLivePositions((current) =>
      current.map((position) =>
        position.positionId !== positionId
          ? position
          : {
              ...position,
              ...(stopLoss !== undefined ? { stopLoss } : {}),
              ...(takeProfit !== undefined ? { takeProfit } : {}),
              updatedAt: Date.now(),
            }
      )
    );

    setTradeActionPending(true);
    setTradeActionError(null);
    try {
      const response = await fetch(
        buildLocalServiceEndpoint("/api/ctrader/live/positions/amend", liveServiceUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: liveSessionId,
            positionId,
            ...(stopLoss !== undefined ? { stopLoss } : {}),
            ...(takeProfit !== undefined ? { takeProfit } : {}),
          }),
        }
      );
      const payload = (await response.json()) as {
        positions?: LivePositionSnapshot[];
        orders?: LiveOrderSnapshot[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to amend live position (${response.status})`);
      }
      setLivePositions(Array.isArray(payload.positions) ? payload.positions : []);
      setLiveOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } catch (amendError) {
      setLivePositions(previousPositions);
      setLiveOrders(previousOrders);
      const message =
        amendError instanceof Error ? amendError.message : "Failed to amend live position.";
      setTradeActionError(message);
      throw amendError;
    } finally {
      setTradeActionPending(false);
    }
  }, [liveOrders, livePositions, liveServiceUrl, liveSessionId]);

  const closeLivePosition = useCallback(async (positionId: string) => {
    if (!liveSessionId) {
      throw new Error("Live session is not ready.");
    }

    setTradeActionPending(true);
    setTradeActionError(null);
    try {
      const response = await fetch(
        buildLocalServiceEndpoint("/api/ctrader/live/positions/close", liveServiceUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: liveSessionId,
            positionId,
          }),
        }
      );
      const payload = (await response.json()) as {
        positions?: LivePositionSnapshot[];
        orders?: LiveOrderSnapshot[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to close live position (${response.status})`);
      }
      setLivePositions(Array.isArray(payload.positions) ? payload.positions : []);
      setLiveOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } catch (closeError) {
      const message =
        closeError instanceof Error ? closeError.message : "Failed to close live position.";
      setTradeActionError(message);
      throw closeError;
    } finally {
      setTradeActionPending(false);
    }
  }, [liveServiceUrl, liveSessionId]);

  const amendLiveOrder = useCallback(async (
    orderId: string,
    patch: {
      limitPrice?: number | null;
      stopPrice?: number | null;
      stopLoss?: number | null;
      takeProfit?: number | null;
    }
  ) => {
    if (!liveSessionId) {
      throw new Error("Live session is not ready.");
    }

    const previousPositions = livePositions;
    const previousOrders = liveOrders;
    setLiveOrders((current) =>
      current.map((order) =>
        order.orderId !== orderId
          ? order
          : {
              ...order,
              ...patch,
            }
      )
    );

    setTradeActionPending(true);
    setTradeActionError(null);
    try {
      const response = await fetch(
        buildLocalServiceEndpoint("/api/ctrader/live/orders/amend", liveServiceUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: liveSessionId,
            orderId,
            ...patch,
          }),
        }
      );
      const payload = (await response.json()) as {
        positions?: LivePositionSnapshot[];
        orders?: LiveOrderSnapshot[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to amend live order (${response.status})`);
      }
      setLivePositions(Array.isArray(payload.positions) ? payload.positions : []);
      setLiveOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } catch (orderError) {
      setLivePositions(previousPositions);
      setLiveOrders(previousOrders);
      const message =
        orderError instanceof Error ? orderError.message : "Failed to amend live order.";
      setTradeActionError(message);
      throw orderError;
    } finally {
      setTradeActionPending(false);
    }
  }, [liveOrders, livePositions, liveServiceUrl, liveSessionId]);

  const cancelLiveOrder = useCallback(async (orderId: string) => {
    if (!liveSessionId) {
      throw new Error("Live session is not ready.");
    }

    setTradeActionPending(true);
    setTradeActionError(null);
    try {
      const response = await fetch(
        buildLocalServiceEndpoint("/api/ctrader/live/orders/cancel", liveServiceUrl),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: liveSessionId,
            orderId,
          }),
        }
      );
      const payload = (await response.json()) as {
        positions?: LivePositionSnapshot[];
        orders?: LiveOrderSnapshot[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed to cancel live order (${response.status})`);
      }
      setLivePositions(Array.isArray(payload.positions) ? payload.positions : []);
      setLiveOrders(Array.isArray(payload.orders) ? payload.orders : []);
    } catch (orderError) {
      const message =
        orderError instanceof Error ? orderError.message : "Failed to cancel live order.";
      setTradeActionError(message);
      throw orderError;
    } finally {
      setTradeActionPending(false);
    }
  }, [liveServiceUrl, liveSessionId]);

  useEffect(() => {
    displayDataRef.current = displayData;
  }, [displayData]);

  useEffect(() => {
    return () => {
      if (silentTradeSyncTimerRef.current != null) {
        window.clearTimeout(silentTradeSyncTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!liveVisualsEnabled || !liveSessionId) {
      setLivePositions([]);
      setLiveOrders([]);
      previousLivePositionIdsRef.current = [];
      return;
    }

    setLivePositions(streamedLivePositions);
    setLiveOrders(streamedLiveOrders);
  }, [
    liveSessionId,
    liveVisualsEnabled,
    streamedLiveOrders,
    streamedLivePositions,
  ]);

  useEffect(() => {
    if (!liveVisualsEnabled || !accountForBroker) {
      previousLivePositionIdsRef.current = [];
      return;
    }

    const previousIds = previousLivePositionIdsRef.current;
    const nextIds = livePositions.map((position) => position.positionId);
    const closedPositionDetected =
      previousIds.length > 0 &&
      previousIds.some((positionId) => !nextIds.includes(positionId));

    previousLivePositionIdsRef.current = nextIds;

    if (closedPositionDetected) {
      scheduleSilentTradeSync();
    }
  }, [accountForBroker, livePositions, liveVisualsEnabled, scheduleSilentTradeSync]);

  useEffect(() => {
    if (!isRichTradeOpen || richTradeOrderType === "MARKET") {
      return;
    }

    seedRichTradePrice(richTradeOrderType, richTradeSide);
  }, [isRichTradeOpen, richTradeOrderType, richTradeSide, seedRichTradePrice]);

  useEffect(() => {
    if (!isRichTradeOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (richTradePopupRef.current?.contains(target)) return;
      if (richTradeButtonRef.current?.contains(target)) return;
      setIsRichTradeOpen(false);
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isRichTradeOpen]);

  const exitReplay = useCallback(() => {
    setIsReplayPlaying(false);
    setIsReplayMode(false);
    setIsReplayPlacementMode(false);
    setReplayIndex(null);
    setReplayStartIndex(null);
    setReplayCursorTimestamp(null);
    setReplayStartTimestamp(null);
    setReplayPlacementTimestamp(null);
    pendingReplayViewportRef.current = null;
  }, []);

  const startReplayAtTimestamp = useCallback(
    (timestamp: number) => {
      if (fullDisplayData.length === 0) return;
      pendingReplayViewportRef.current = chartRef.current?.getVisibleLogicalRange() ?? null;
      const anchorIndex = findReplayStartIndex(fullDisplayData, timestamp);
      const anchorTimestamp = fullDisplayData[anchorIndex]?.timestamp ?? timestamp;
      setIsReplayPlaying(false);
      setIsReplayPlacementMode(false);
      setReplayPlacementTimestamp(anchorTimestamp);
      setIsReplayMode(true);
      setReplayStartIndex(anchorIndex);
      setReplayStartTimestamp(anchorTimestamp);
      setReplayIndex(anchorIndex);
      setReplayCursorTimestamp(anchorTimestamp);
    },
    [fullDisplayData]
  );

  const getReplayAnchorIndex = useCallback(() => {
    if (fullDisplayData.length === 0) return 0;
    const anchorTimestamp =
      chartRef.current?.getViewportCenterTimestamp() ??
      focusTimestamp ??
      fullDisplayData[fullDisplayData.length - 1]?.timestamp ??
      null;
    return findNearestReplayIndex(fullDisplayData, anchorTimestamp);
  }, [focusTimestamp, fullDisplayData]);

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

    if (fullDisplayData.length === 0) return;

    const anchorIndex = getReplayAnchorIndex();
    setIsReplayPlaying(false);
    setIsReplayPlacementMode(true);
    setReplayPlacementTimestamp(fullDisplayData[anchorIndex]?.timestamp ?? null);
    setSymbolMenuOpen(false);
    setTimeframeMenuOpen(false);
    setTradesMenuOpen(false);
    setCompactActionsOpen(false);
    setCompactDrawOpen(false);
  }, [
    exitReplay,
    fullDisplayData,
    getReplayAnchorIndex,
    isReplayMode,
    isReplayPlacementMode,
  ]);

  const stepReplay = useCallback(
    (delta: number) => {
      if (fullDisplayData.length === 0) return;
      setIsReplayPlaying(false);
      const baseIndex = replayIndex ?? getReplayAnchorIndex();
      const nextIndex = clampReplayIndex(baseIndex + delta, fullDisplayData.length);
      setReplayIndex(nextIndex);
      setReplayCursorTimestamp(fullDisplayData[nextIndex]?.timestamp ?? null);
    },
    [fullDisplayData, getReplayAnchorIndex, replayIndex]
  );

  const handleReplayReset = useCallback(() => {
    if (fullDisplayData.length === 0) return;
    const anchorTimestamp =
      replayStartTimestamp ??
      (replayStartIndex != null ? fullDisplayData[replayStartIndex]?.timestamp ?? null : null);
    if (anchorTimestamp == null) return;
    const anchorIndex = findReplayStartIndex(fullDisplayData, anchorTimestamp);
    setIsReplayPlaying(false);
    setReplayStartIndex(anchorIndex);
    setReplayIndex(anchorIndex);
    setReplayCursorTimestamp(fullDisplayData[anchorIndex]?.timestamp ?? anchorTimestamp);
  }, [fullDisplayData, replayStartIndex, replayStartTimestamp]);

  useEffect(() => {
    if (!availableDateRange) {
      if (goToDate) setGoToDate("");
      if (focusTimestamp != null) setFocusTimestamp(null);
      return;
    }

    const parsedGoToDate = fromDateInputValue(goToDate);
    const preferredTimestamp =
      focusTimestamp ??
      (Number.isFinite(parsedGoToDate) ? parsedGoToDate : null) ??
      availableDateRange.to;
    const clampedTimestamp = Math.max(
      availableDateRange.from,
      Math.min(availableDateRange.to, preferredTimestamp)
    );
    const nextGoToDate = toDateInputValue(clampedTimestamp);

    if (goToDate !== nextGoToDate) {
      setGoToDate(nextGoToDate);
    }
    if (focusTimestamp !== clampedTimestamp) {
      setFocusTimestamp(clampedTimestamp);
    }
  }, [availableDateRange, focusTimestamp, goToDate]);

  useEffect(() => {
    if (
      selectedTradeHistoryId == null ||
      brokerSymbolTrades.some((trade) => trade.id === selectedTradeHistoryId)
    ) {
      return;
    }
    setSelectedTradeHistoryId(null);
  }, [brokerSymbolTrades, selectedTradeHistoryId]);

  useEffect(() => {
    if (!isReplayMode) return;
    if (fullDisplayData.length === 0) {
      setIsReplayPlaying(false);
      setReplayIndex(null);
      setReplayStartIndex(null);
      setReplayCursorTimestamp(null);
      setReplayStartTimestamp(null);
      return;
    }

    const fallbackIndex = getReplayAnchorIndex();
    const resolvedStartTimestamp =
      replayStartTimestamp ?? fullDisplayData[fallbackIndex]?.timestamp ?? null;
    const resolvedCursorTimestamp =
      replayCursorTimestamp ?? resolvedStartTimestamp;

    const nextStartIndex =
      resolvedStartTimestamp == null
        ? fallbackIndex
        : findReplayStartIndex(fullDisplayData, resolvedStartTimestamp);
    const nextCursorIndex =
      resolvedCursorTimestamp == null
        ? nextStartIndex
        : findReplayStartIndex(fullDisplayData, resolvedCursorTimestamp);

    setReplayStartIndex(nextStartIndex);
    setReplayIndex(nextCursorIndex);
    setReplayStartTimestamp(fullDisplayData[nextStartIndex]?.timestamp ?? resolvedStartTimestamp);
    setReplayCursorTimestamp(fullDisplayData[nextCursorIndex]?.timestamp ?? resolvedCursorTimestamp);
  }, [fullDisplayData, getReplayAnchorIndex, isReplayMode, replayCursorTimestamp, replayStartTimestamp]);

  useEffect(() => {
    if (!isReplayMode || !isReplayPlaying || effectiveReplayIndex == null) return;

    if (effectiveReplayIndex >= fullDisplayData.length - 1) {
      setIsReplayPlaying(false);
      return;
    }

    replayTimerRef.current = window.setTimeout(() => {
      const nextIndex = clampReplayIndex(effectiveReplayIndex + 1, fullDisplayData.length);
      setReplayIndex(nextIndex);
      setReplayCursorTimestamp(fullDisplayData[nextIndex]?.timestamp ?? null);
    }, replayIntervalMs);

    return () => {
      if (replayTimerRef.current != null) {
        window.clearTimeout(replayTimerRef.current);
        replayTimerRef.current = null;
      }
    };
  }, [
    effectiveReplayIndex,
    fullDisplayData,
    isReplayMode,
    isReplayPlaying,
    replayIntervalMs,
  ]);

  useEffect(() => {
    if (!isReplayMode || displayData.length === 0) return;
    const pendingViewport = pendingReplayViewportRef.current;
    if (!pendingViewport) return;

    pendingReplayViewportRef.current = null;
    const timer = window.setTimeout(() => {
      chartRef.current?.setVisibleLogicalRange(pendingViewport);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [displayData.length, isReplayMode]);

  useEffect(() => {
    if (
      !isReplayMode ||
      !isReplayPlaying ||
      effectiveReplayIndex == null ||
      fullDisplayData.length === 0
    ) {
      return;
    }

    if (fullDisplayData.length - 1 - effectiveReplayIndex <= 10) {
      void fetchNext();
    }
  }, [
    effectiveReplayIndex,
    fetchNext,
    fullDisplayData.length,
    isReplayMode,
    isReplayPlaying,
  ]);

  // Restore drawings and viewport after timeframe data loads
  useEffect(() => {
    const pending = pendingRestoreRef.current;
    if (!pending || fullDisplayData.length === 0 || isLoading) return;
    if (!areDrawingsCoveredByBars(pending.drawings, fullDisplayData)) return;
    pendingRestoreRef.current = null;
    // Small delay so chart processes the new data first
    const timer = window.setTimeout(() => {
      chartRef.current?.removeAllDrawingTools();
      if (pending.drawings.length > 0) {
        chartRef.current?.importDrawings(pending.drawings);
      }
      if (pending.preferLatestTimestamp) {
        const latestTimestamp =
          fullDisplayData[fullDisplayData.length - 1]?.timestamp ?? null;
        if (latestTimestamp != null) {
          chartRef.current?.scrollToTimestamp(
            latestTimestamp,
            pending.windowSeconds ?? undefined
          );
        }
      } else if (pending.centerTimestamp != null) {
        chartRef.current?.scrollToTimestamp(
          pending.centerTimestamp,
          pending.windowSeconds ?? undefined
        );
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [fullDisplayData, isLoading]);

  useEffect(() => {
    const request = observationLoadRequest;
    if (!request) return;
    if (request.context.workspaceMode && request.context.workspaceMode !== "synced") {
      return;
    }
    if (lastHandledObservationRequestRef.current === request.requestId) {
      return;
    }

    lastHandledObservationRequestRef.current = request.requestId;
    exitReplay();
    const nextSymbol = request.context.symbol ?? selection?.symbol ?? null;
    const nextBroker = request.context.broker ?? selection?.broker ?? null;
    const nextTimeframe = request.context.timeframe;
    const drawings = (request.context.drawings ?? []) as DrawingToolExport[];
    const pending = {
      drawings,
      centerTimestamp: request.context.centerTimestamp ?? null,
      windowSeconds: request.context.windowSeconds ?? null,
    };

    if (nextSymbol && nextBroker) {
      setStoredSelection({ broker: nextBroker, symbol: nextSymbol });
      onSymbolChange?.(nextSymbol, nextBroker);
    }

    if (nextTimeframe && TIMEFRAMES.includes(nextTimeframe)) {
      setTimeframe(nextTimeframe);
      onTimeframeChange?.(nextTimeframe);
    }

    pendingRestoreRef.current = pending;
    setTimeframeRestoreAnchor({
      centerTimestamp: pending.centerTimestamp,
      windowDays: getDrawingWindowDays(pending.centerTimestamp, drawings),
    });

    const selectionMatches =
      (nextSymbol == null || nextSymbol === selection?.symbol) &&
      (nextBroker == null || nextBroker === selection?.broker);
    const timeframeMatches = !nextTimeframe || nextTimeframe === timeframe;

    if (selectionMatches && timeframeMatches && fullDisplayData.length > 0 && !isLoading) {
      pendingRestoreRef.current = null;
      window.setTimeout(() => {
        chartRef.current?.removeAllDrawingTools();
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
    exitReplay,
    fullDisplayData.length,
    isLoading,
    observationLoadRequest,
    onObservationLoadHandled,
    onSymbolChange,
    onTimeframeChange,
    selection?.broker,
    selection?.symbol,
    timeframe,
  ]);

  const runQueuedPreviousFetch = useCallback(() => {
    lastPrevFetchRef.current = Date.now();
    fetchingPrevRef.current = true;
    void fetchPrevious().finally(() => {
      fetchingPrevRef.current = false;
      window.setTimeout(() => {
        if (pendingPrevFetchRef.current && !fetchingPrevRef.current) {
          pendingPrevFetchRef.current = false;
          runQueuedPreviousFetch();
        }
      }, 80);
    });
  }, [fetchPrevious]);

  const runQueuedNextFetch = useCallback(() => {
    lastNextFetchRef.current = Date.now();
    fetchingNextRef.current = true;
    void fetchNext().finally(() => {
      fetchingNextRef.current = false;
      window.setTimeout(() => {
        if (pendingNextFetchRef.current && !fetchingNextRef.current) {
          pendingNextFetchRef.current = false;
          runQueuedNextFetch();
        }
      }, 80);
    });
  }, [fetchNext]);

  const handleVisibleRangeChange = useCallback(
    (from: number, to: number) => {
      if (data.length === 0) return;
      const visibleBarsLength = displayData.length;
      if (visibleBarsLength === 0) return;

      if (isReplayMode) {
        lastVisibleRangeRef.current = { from, to };
        return;
      }

      const previousRange = lastVisibleRangeRef.current;
      const currentCenter = (from + to) / 2;
      const previousCenter = previousRange ? (previousRange.from + previousRange.to) / 2 : currentCenter;
      const panDirection = Math.sign(currentCenter - previousCenter);
      lastVisibleRangeRef.current = { from, to };

      const leftIndex = Math.floor(from);
      const rightIndex = Math.ceil(to);
      const nearLeft = leftIndex <= EDGE_FETCH_THRESHOLD;
      const nearRight = rightIndex >= visibleBarsLength - EDGE_FETCH_THRESHOLD;

      let shouldFetchPrev = nearLeft;
      let shouldFetchNext =
        nearRight &&
        (!isReplayMode ||
          effectiveReplayIndex == null ||
          effectiveReplayIndex >= fullDisplayData.length - 1);

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

      if (shouldFetchPrev) {
        const now = Date.now();
        if (fetchingPrevRef.current) {
          pendingPrevFetchRef.current = true;
        } else if (now - lastPrevFetchRef.current >= FETCH_THROTTLE_MS) {
          runQueuedPreviousFetch();
        }
      }

      if (shouldFetchNext) {
        const now = Date.now();
        if (fetchingNextRef.current) {
          pendingNextFetchRef.current = true;
        } else if (now - lastNextFetchRef.current >= FETCH_THROTTLE_MS) {
          runQueuedNextFetch();
        }
      }
    },
    [
      data.length,
      displayData.length,
      effectiveReplayIndex,
      fullDisplayData.length,
      isReplayMode,
      runQueuedNextFetch,
      runQueuedPreviousFetch,
    ]
  );

  const handleTradeHistorySelect = useCallback(
    (trade: Trade) => {
      exitReplay();
      setSelectedTradeHistoryId(trade.id ?? null);

      const openTime = new Date(trade.openTime).getTime();
      const closeTime = trade.closeTime ? new Date(trade.closeTime).getTime() : openTime;
      const centerTimestamp = Math.round((openTime + closeTime) / 2);

      const currentDisplayData = displayDataRef.current;
      const loadedStart = currentDisplayData[0]?.timestamp ?? 0;
      const loadedEnd = currentDisplayData[currentDisplayData.length - 1]?.timestamp ?? 0;
      if (
        currentDisplayData.length > 0 &&
        centerTimestamp >= loadedStart &&
        centerTimestamp <= loadedEnd
      ) {
        chartRef.current?.scrollToTimestamp(centerTimestamp);
        return;
      }

      const drawings = chartRef.current?.exportAllDrawings() ?? [];
      pendingRestoreRef.current = {
        drawings,
        centerTimestamp,
        windowSeconds: chartRef.current?.getVisibleWindowSeconds() ?? null,
      };
      setTimeframeRestoreAnchor({
        centerTimestamp,
        windowDays: getDrawingWindowDays(centerTimestamp, drawings),
      });
    },
    [exitReplay]
  );

  const goToTimestamp = useCallback(
    (targetTimestamp: number) => {
      if (!availableDateRange) return;

      exitReplay();
      const clampedTimestamp = Math.max(
        availableDateRange.from,
        Math.min(availableDateRange.to, targetTimestamp)
      );
      pendingGoToTimestampRef.current = clampedTimestamp;
      setFocusTimestamp(clampedTimestamp);
      setGoToDate(toDateInputValue(clampedTimestamp));
      setIsDatePickerOpen(false);
    },
    [availableDateRange, exitReplay]
  );

  const applyGoToDate = useCallback(
    (date: Date) => {
      const targetTimestamp = fromDateInputValue(toDateInputValue(date.getTime()));
      if (!Number.isFinite(targetTimestamp)) return;
      goToTimestamp(targetTimestamp);
    },
    [goToTimestamp]
  );

  const openAlertForm = useCallback(() => {
    const referencePrice = getAlertReferencePrice(alertPriceSide);
    const nextTargetPrice = formatLivePriceInput(referencePrice);

    setAlertTargetPrice(nextTargetPrice);
    if (referencePrice != null && Number.isFinite(referencePrice)) {
      setAlertCondition(deriveAlertConditionForSide(referencePrice, alertPriceSide));
    }
    setAlertNote("");
    setAlertActionError(null);
    setIsAlertFormOpen(true);
  }, [alertPriceSide, deriveAlertConditionForSide, getAlertReferencePrice]);

  const handleCreateAlert = useCallback(async () => {
    if (!selection) {
      setAlertActionError("Select a symbol before creating an alert.");
      return;
    }

    const targetPrice = Number(alertTargetPrice);
    if (!Number.isFinite(targetPrice)) {
      setAlertActionError("Enter a valid target price.");
      return;
    }

    try {
      setAlertActionPending(true);
      setAlertActionError(null);
      const nextCondition = deriveAlertConditionForSide(targetPrice, alertPriceSide);
      await createAlert({
        broker: selection.broker,
        symbol: selection.symbol,
        condition: nextCondition,
        priceSide: alertPriceSide,
        targetPrice,
        note: alertNote,
      });
      setIsAlertFormOpen(false);
      setAlertNote("");
    } catch (createError) {
      setAlertActionError(
        createError instanceof Error ? createError.message : "Failed to create alert."
      );
    } finally {
      setAlertActionPending(false);
    }
  }, [
    alertNote,
    alertPriceSide,
    alertTargetPrice,
    createAlert,
    deriveAlertConditionForSide,
    selection,
  ]);

  const handleDeleteAlert = useCallback(async (alertId: string) => {
    try {
      setAlertActionError(null);
      await deleteAlert(alertId);
    } catch (deleteError) {
      setAlertActionError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete alert."
      );
    }
  }, [deleteAlert]);

  const handleQuickChartAlertCreate = useCallback(async (targetPrice: number) => {
    if (!selection || !Number.isFinite(targetPrice)) {
      return;
    }

    try {
      setAlertActionPending(true);
      setAlertActionError(null);
      await createAlert({
        broker: selection.broker,
        symbol: selection.symbol,
        condition: deriveAlertConditionForSide(targetPrice, "bid"),
        priceSide: "bid",
        targetPrice,
      });
    } catch (createError) {
      setAlertActionError(
        createError instanceof Error ? createError.message : "Failed to create alert."
      );
    } finally {
      setAlertActionPending(false);
    }
  }, [createAlert, deriveAlertConditionForSide, selection]);

  const handleQuickChartOrderCreate = useCallback(async (
    side: "BUY" | "SELL",
    orderType: "LIMIT" | "STOP",
    targetPrice: number
  ) => {
    if (!Number.isFinite(targetPrice) || !canTradeLive) {
      return;
    }

    await submitTradeRequest({
      side,
      orderType,
      lots: resolvedLongShortLots,
      ...(orderType === "LIMIT"
        ? { limitPrice: targetPrice }
        : { stopPrice: targetPrice }),
    });
  }, [canTradeLive, resolvedLongShortLots, submitTradeRequest]);

  const handleAlertChartMove = useCallback(async (alertId: string, targetPrice: number, priceSide: PriceAlertPriceSide) => {
    if (!Number.isFinite(targetPrice)) return;

    try {
      setAlertActionError(null);
      await updateAlert(alertId, {
        targetPrice,
        condition: deriveAlertConditionForSide(targetPrice, priceSide),
      });
    } catch (updateError) {
      setAlertActionError(
        updateError instanceof Error ? updateError.message : "Failed to update alert."
      );
    }
  }, [deriveAlertConditionForSide, updateAlert]);

  const handleTradeHistoryPanelClose = useCallback(() => {
    setShowTradePanel(false);
  }, []);

  useLayoutEffect(() => {
    if (!onTradePanelChange) return;
    if (!isActive || !showTradePanel) {
      onTradePanelChange(null);
      return;
    }

    onTradePanelChange({
      symbol: selection?.symbol ?? null,
      broker: selection?.broker ?? null,
      trades: brokerSymbolTrades,
      selectedTradeId: selectedTradeHistoryId,
      onSelectTrade: handleTradeHistorySelect,
      liveModeEnabled,
      livePositions,
      liveOrders,
      liveBidPrice: liveQuote?.bid ?? null,
      liveAskPrice: liveQuote?.ask ?? null,
      priceAlerts: symbolPriceAlerts,
      recentAlertEvents: symbolAlertEvents,
      onClosePosition: closeLivePosition,
      onCancelOrder: cancelLiveOrder,
      onDeleteAlert: handleDeleteAlert,
      onClose: handleTradeHistoryPanelClose,
    });
  }, [
    brokerSymbolTrades,
    cancelLiveOrder,
    closeLivePosition,
    handleDeleteAlert,
    handleTradeHistoryPanelClose,
    handleTradeHistorySelect,
    isActive,
    liveModeEnabled,
    liveQuote?.ask,
    liveQuote?.bid,
    liveOrders,
    livePositions,
    onTradePanelChange,
    symbolAlertEvents,
    symbolPriceAlerts,
    selectedTradeHistoryId,
    selection?.broker,
    selection?.symbol,
    showTradePanel,
  ]);

  useEffect(() => {
    if (!onTradePanelChange) return;
    return () => {
      onTradePanelChange(null);
    };
  }, [onTradePanelChange]);

  useEffect(() => {
    fetchingPrevRef.current = false;
    fetchingNextRef.current = false;
    pendingPrevFetchRef.current = false;
    pendingNextFetchRef.current = false;
    lastPrevFetchRef.current = 0;
    lastNextFetchRef.current = 0;
    lastVisibleRangeRef.current = null;
  }, [selection?.broker, selection?.symbol, timeframe]);

  useEffect(() => {
    if (displayData.length === 0 || isLoading) return;
    const pendingTimestamp = pendingGoToTimestampRef.current;
    if (pendingTimestamp == null) return;

    pendingGoToTimestampRef.current = null;
    window.setTimeout(() => {
      chartRef.current?.scrollToTimestamp(pendingTimestamp);
      lastVisibleRangeRef.current = null;
    }, 80);
  }, [displayData, isLoading]);

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
  const chartLoadErrorMessage = error?.message ?? null;
  const liveModeIssueMessage = liveError ?? null;
  const displayedAlertIssueMessage = alertActionError ?? priceAlertsError ?? null;
  const alertTriggeredMessage = alertFlashEvent
    ? `Alert triggered for ${alertFlashEvent.symbol}: ${formatAlertConditionLabel(alertFlashEvent.condition)} on ${alertFlashEvent.priceSide.toUpperCase()} at ${formatLivePrice(alertFlashEvent.triggerPrice)}.`
    : null;

  const handleQuickTrade = useCallback(async (side: "BUY" | "SELL") => {
    if (!canTradeLive) return;
    setRichTradeSide(side);
    await submitTradeRequest({
      side,
      orderType: "MARKET",
      lots: resolvedLongShortLots,
    });
  }, [canTradeLive, resolvedLongShortLots, submitTradeRequest]);

  const handleRichTradeSubmit = useCallback(async () => {
    if (!liveSessionId) return;
    const stopLoss = parseOptionalNumberInput(richTradeStopLoss);
    const takeProfit = parseOptionalNumberInput(richTradeTakeProfit);
    const hasStopLoss = Number.isFinite(stopLoss);
    const hasTakeProfit = Number.isFinite(takeProfit);
    const response = await submitTradeRequest({
      side: richTradeSide,
      orderType: richTradeOrderType,
      lots: resolvedLongShortLots,
      ...(Number.isFinite(parseOptionalNumberInput(richTradePrice))
        ? richTradeOrderType === "LIMIT"
          ? { limitPrice: parseOptionalNumberInput(richTradePrice) }
          : richTradeOrderType === "STOP"
            ? { stopPrice: parseOptionalNumberInput(richTradePrice) }
            : {}
        : {}),
      ...(richTradeOrderType !== "MARKET" && hasStopLoss ? { stopLoss } : {}),
      ...(richTradeOrderType !== "MARKET" && hasTakeProfit ? { takeProfit } : {}),
      ...(richTradeComment.trim() ? { comment: richTradeComment.trim() } : {}),
    });

    if (richTradeOrderType !== "MARKET" || (!hasStopLoss && !hasTakeProfit)) {
      return;
    }

    const createdPositionId =
      response?.execution?.positionId != null
        ? String(response.execution.positionId)
        : response?.positions?.find((position) =>
            position.symbol === selection?.symbol &&
            position.direction === (richTradeSide === "BUY" ? "Buy" : "Sell") &&
            !livePositions.some(
              (previousPosition) => previousPosition.positionId === position.positionId
            )
          )?.positionId ?? null;

    if (!createdPositionId) {
      throw new Error(
        "Trade was opened, but stop loss / take profit could not be attached automatically."
      );
    }

    await amendLivePosition(
      createdPositionId,
      hasStopLoss ? stopLoss : undefined,
      hasTakeProfit ? takeProfit : undefined
    );
  }, [
    amendLivePosition,
    livePositions,
    liveSessionId,
    resolvedLongShortLots,
    richTradeComment,
    richTradeOrderType,
    richTradePrice,
    richTradeSide,
    richTradeStopLoss,
    richTradeTakeProfit,
    selection?.symbol,
    submitTradeRequest,
  ]);

  const handleLivePositionAdjust = useCallback(async (positionId: string, stopLoss?: number | null, takeProfit?: number | null) => {
    await amendLivePosition(positionId, stopLoss, takeProfit);
  }, [amendLivePosition]);

  const handleLiveOrderAdjust = useCallback(async (
    orderId: string,
    patch: {
      limitPrice?: number | null;
      stopPrice?: number | null;
      stopLoss?: number | null;
      takeProfit?: number | null;
    }
  ) => {
    await amendLiveOrder(orderId, patch);
  }, [amendLiveOrder]);

  const handleLivePositionClose = useCallback(async (positionId: string) => {
    await closeLivePosition(positionId);
  }, [closeLivePosition]);

  const handleLiveOrderCancel = useCallback(async (orderId: string) => {
    await cancelLiveOrder(orderId);
  }, [cancelLiveOrder]);

  const headerControls = useMemo(() => {
    if (compact) return null;

    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => setLiveModeEnabled((previous) => !previous)}
          disabled={!selection || !accessToken || !liveAccountNumber}
          className={`inline-flex py-1 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors disabled:opacity-50 ${
            liveModeEnabled
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          <span>{liveModeEnabled ? "Live On" : "Live Off"}</span>
        </button>
        <div className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${liveStatusClassName}`}>
          {liveStatusLabel}
        </div>
        {liveModeEnabled ? (
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-card/70 px-1.5 py-1">
            <button
              type="button"
              onClick={() => void handleQuickTrade("SELL")}
              disabled={!canTradeLive || tradeActionPending}
              className="flex min-w-[86px] items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1 text-center text-[12px] font-semibold uppercase tracking-wide text-rose-300 transition-colors hover:bg-rose-500/15 disabled:opacity-50"
            >
              Sell
            </button>
            <div className="flex min-w-[62px] flex-col items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={resolvedLongShortLots}
                onChange={(event) => setLongShortLots(Math.max(0.01, Number(event.target.value) || 0.01))}
                className="h-7 w-[62px] rounded-md border border-border bg-background px-2 text-center text-[11px] tabular-nums text-foreground"
                aria-label="Quick trade lot size"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleQuickTrade("BUY")}
              disabled={!canTradeLive || tradeActionPending}
              className="flex min-w-[86px] items-center justify-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-center text-[12px] font-semibold uppercase tracking-wide text-emerald-300 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
            >
              Buy
            </button>
          </div>
        ) : null}
      </div>
    );
  }, [
    accessToken,
    canTradeLive,
    compact,
    handleQuickTrade,
    liveAccountNumber,
    liveModeEnabled,
    liveStatusClassName,
    liveStatusLabel,
    resolvedLongShortLots,
    selection,
    tradeActionPending,
  ]);

  useEffect(() => {
    if (!onHeaderControlsChange || !isActive) return;
    onHeaderControlsChange(headerControls);
    return () => {
      onHeaderControlsChange(null);
    };
  }, [headerControls, isActive, onHeaderControlsChange]);

  const toolbar = (
    <div className={`relative z-20 flex flex-wrap items-center gap-2 border-b border-border ${compact ? 'pb-1.5' : 'pb-3'}`}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <div className="relative">
        <button
          ref={symbolButtonRef}
          type="button"
          onClick={() => {
            setSymbolMenuOpen((open) => !open);
            setTradesMenuOpen(false);
          }}
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
                        persistCurrentDrawings();
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
          onClick={() => {
            persistCurrentDrawings();
            setTimeframeMenuOpen((open) => !open);
            setTradesMenuOpen(false);
          }}
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
                  persistCurrentDrawings();
                  const drawings = chartRef.current?.exportAllDrawings() ?? [];
                  const centerTimestamp =
                    chartRef.current?.getViewportCenterTimestamp() ?? null;
                  const latestDisplayTimestamp =
                    availableDateRange?.to ??
                    centerTimestamp;
                  // Save drawings and viewport before timeframe change
                  pendingRestoreRef.current = {
                    drawings,
                    centerTimestamp: liveVisualsEnabled
                      ? latestDisplayTimestamp
                      : centerTimestamp,
                    windowSeconds: chartRef.current?.getVisibleWindowSeconds() ?? null,
                    preferLatestTimestamp: liveVisualsEnabled,
                  };
                  setTimeframeRestoreAnchor({
                    centerTimestamp: liveVisualsEnabled
                      ? latestDisplayTimestamp
                      : centerTimestamp,
                    windowDays: liveVisualsEnabled
                      ? 0
                      : getDrawingWindowDays(centerTimestamp, drawings),
                  });
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

      <div className="relative" ref={datePickerRef}>
        <button
          type="button"
          onClick={() => {
            setIsDatePickerOpen((open) => !open);
            setSymbolMenuOpen(false);
            setTimeframeMenuOpen(false);
            setTradesMenuOpen(false);
          }}
          disabled={!availableDateRange || !goToDate}
          className="flex h-7 items-center gap-2 rounded border border-border bg-background px-2 text-xs font-medium text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span>{goToDate ? format(new Date(`${goToDate}T00:00:00`), "MMM d, yyyy") : "Select date"}</span>
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        </button>
        {isDatePickerOpen && availableDateRange && goToDate ? (
          <SingleDatePopover
            key={goToDate}
            value={new Date(`${goToDate}T00:00:00`)}
            min={new Date(availableDateRange.from)}
            max={new Date(availableDateRange.to)}
            onClose={() => setIsDatePickerOpen(false)}
            onApply={applyGoToDate}
          />
        ) : null}
      </div>

      <TimeGuidesControls
        value={timeGuides}
        onChange={setTimeGuides}
        compact={compact}
        disabled={!selection}
      />

      <div className="relative">
        <button
          ref={tradesButtonRef}
          type="button"
          onClick={() => {
            setTradesMenuOpen((open) => !open);
            setSymbolMenuOpen(false);
            setTimeframeMenuOpen(false);
          }}
          disabled={!selection}
          className={`flex h-7 items-center gap-1.5 rounded border border-border px-2 text-[11px] transition-colors ${
            showTradeOverlay || showTradePanel || showLiveTradesOnChart
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span className="font-medium">Trades</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {tradesMenuOpen ? (
          <div
            ref={tradesMenuRef}
            className="absolute left-0 top-full z-50 mt-1 min-w-[170px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl"
          >
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs transition-colors hover:bg-muted">
              <input
                type="checkbox"
                checked={showTradeOverlay}
                onChange={(event) => setShowTradeOverlay(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span>On chart</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs transition-colors hover:bg-muted">
              <input
                type="checkbox"
                checked={showTradePanel}
                onChange={(event) => setShowTradePanel(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span>Sidebar</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs transition-colors hover:bg-muted">
              <input
                type="checkbox"
                checked={showLiveTradesOnChart}
                onChange={(event) => setShowLiveTradesOnChart(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-border accent-primary"
              />
              <span>Live / pending</span>
            </label>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setShowAlertsOnChart((current) => !current)}
        disabled={!selection}
        className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] transition-colors ${
          showAlertsOnChart
            ? "border-primary/60 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:bg-muted"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        title={showAlertsOnChart ? "Hide alert lines on chart" : "Show alert lines on chart"}
      >
        <Bell className="h-3.5 w-3.5" />
              <span className="rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] tabular-nums text-foreground">
          {symbolPriceAlerts.length}
        </span>
      </button>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={handleReplayToggle}
          disabled={!selection || fullDisplayData.length === 0}
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
                : "Pick replay start on chart"
          }
        >
          {isReplayMode ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          <span>
            {isReplayMode ? "Exit Replay" : isReplayPlacementMode ? "Cancel Pick" : "Replay"}
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
              {effectiveReplayIndex != null ? `${effectiveReplayIndex + 1}/${fullDisplayData.length}` : "0/0"}
            </span>
          </div>
        ) : null}
   
      </div>

      <div className="relative" ref={richTradePopupRef}>
        <button
          ref={richTradeButtonRef}
          type="button"
          onClick={() => {
            const nextOpen = !isRichTradeOpen;
            setIsRichTradeOpen(nextOpen);
            if (nextOpen && richTradeOrderType !== "MARKET") {
              seedRichTradePrice(richTradeOrderType, richTradeSide);
            }
            setSymbolMenuOpen(false);
            setTimeframeMenuOpen(false);
            setTradesMenuOpen(false);
            setCompactActionsOpen(false);
          }}
          disabled={!liveModeEnabled || !liveSessionId}
          className={`flex h-7 items-center gap-1.5 rounded border px-2 text-[11px] font-medium transition-colors ${
            isRichTradeOpen
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          } disabled:cursor-not-allowed disabled:opacity-50`}
          title="Rich trade placement"
        >
          <span>Trade</span>
          <ChevronDown className="h-3 w-3" />
        </button>

        {isRichTradeOpen ? (
          <div className="absolute left-0 top-full z-50 mt-1 w-[320px] rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-2xl">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setRichTradeSide("BUY");
                  seedRichTradePrice(richTradeOrderType, "BUY", { force: true });
                }}
                className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  richTradeSide === "BUY"
                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                Buy
              </button>
              <button
                type="button"
                onClick={() => {
                  setRichTradeSide("SELL");
                  seedRichTradePrice(richTradeOrderType, "SELL", { force: true });
                }}
                className={`rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors ${
                  richTradeSide === "SELL"
                    ? "border-rose-500/50 bg-rose-500/15 text-rose-300"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                Sell
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Order
                <select
                  value={richTradeOrderType}
                  onChange={(event) => {
                    const nextOrderType = event.target.value as LiveOrderType;
                    setRichTradeOrderType(nextOrderType);
                    if (nextOrderType !== "MARKET") {
                      seedRichTradePrice(nextOrderType, richTradeSide, { force: true });
                    }
                  }}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="MARKET">Market</option>
                  <option value="LIMIT">Limit</option>
                  <option value="STOP">Stop</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Lots
                <input
                  type="number"
                  inputMode="decimal"
                  min={0.01}
                  step={0.01}
                  value={resolvedLongShortLots}
                  onChange={(event) => setLongShortLots(Math.max(0.01, Number(event.target.value) || 0.01))}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Price
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={richTradeOrderType === "MARKET" ? liveReferenceTradePriceInput : richTradePrice}
                  onChange={(event) => setRichTradePrice(event.target.value)}
                  disabled={richTradeOrderType === "MARKET"}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Stop Loss Price
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={richTradeStopLoss}
                  onChange={(event) => updateStopLossFromPrice(event.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Stop Loss Pips
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  value={richTradeStopLossPips}
                  onChange={(event) => updateStopLossFromPips(event.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Take Profit Price
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  value={richTradeTakeProfit}
                  onChange={(event) => updateTakeProfitFromPrice(event.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Take Profit Pips
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  value={richTradeTakeProfitPips}
                  onChange={(event) => updateTakeProfitFromPips(event.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Comment
                <input
                  type="text"
                  value={richTradeComment}
                  onChange={(event) => setRichTradeComment(event.target.value)}
                  className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                />
              </label>
            </div>
            {tradeActionError ? (
              <div className="mt-3 flex items-start justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                <span className="min-w-0 flex-1">{tradeActionError}</span>
                <button
                  type="button"
                  onClick={() => setTradeActionError(null)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-current/80 transition-colors hover:bg-black/10 hover:text-current dark:hover:bg-white/10"
                  aria-label="Close trade error"
                  title="Close"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : null}
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="text-[11px] text-muted-foreground">
                {liveQuote?.bid != null && liveQuote?.ask != null
                  ? `${liveBidLabel} / ${liveAskLabel}`
                  : liveCurrentBar
                    ? liveAskLabel
                    : "Waiting for live quote"}
              </div>
              <button
                type="button"
                onClick={() => void handleRichTradeSubmit()}
                disabled={tradeActionPending || !liveSessionId}
                className={`rounded-md border px-3 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                  richTradeSide === "BUY"
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/20"
                    : "border-rose-500/40 bg-rose-500/15 text-rose-300 hover:bg-rose-500/20"
                }`}
              >
                {tradeActionPending ? "Placing..." : `Place ${richTradeSide === "BUY" ? "Buy" : "Sell"}`}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {!compact ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
            const showCalloutControls =
              drawingTool === "Callout" || selectedDrawingTool === "Callout";
            const showLotsControls =
              drawingTool === "LongShortPosition" ||
              selectedDrawingTool === "LongShortPosition";
            return (
              <>
                <label className="flex h-7 items-center gap-2 rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={continuousDrawingEnabled}
                    onChange={(event) => setContinuousDrawingEnabled(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span className="whitespace-nowrap font-medium">Cts draw</span>
                </label>
                <div
                  className={`h-7 items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${
                    showDrawControls
                      ? "flex opacity-100"
                      : "hidden pointer-events-none opacity-0"
                  }`}
                  aria-hidden={!showDrawControls}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Draw color
                  </span>
                  <input
                    type="color"
                    aria-label="Rectangle fill color"
                    value={rectangleFillColor}
                    onChange={(event) => setRectangleFillColor(event.target.value)}
                    className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="range"
                    aria-label="Rectangle fill opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={rectangleFillOpacity}
                    onChange={(event) => setRectangleFillOpacity(Number(event.target.value))}
                    className="h-1.5 w-14 accent-foreground"
                  />
                </div>
                <div
                  className={`h-7 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${
                    showCalloutControls
                      ? "flex opacity-100"
                      : "hidden pointer-events-none opacity-0"
                  }`}
                  aria-hidden={!showCalloutControls}
                >
                  <textarea
                    ref={calloutTextInputRef}
                    value={calloutText}
                    onChange={(event) => setCalloutText(event.target.value)}
                    onKeyDown={handleCalloutTextKeyDown}
                    placeholder="Text"
                    rows={1}
                    className="h-7 w-28 resize-none rounded border border-border bg-background px-1.5 py-1 text-[10px] leading-[1.2] text-foreground"
                  />
                  <input
                    type="color"
                    value={calloutTextColor}
                    onChange={(event) => setCalloutTextColor(event.target.value)}
                    className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                    aria-label="Text color"
                  />
                  <input
                    type="color"
                    value={calloutLineColor}
                    onChange={(event) => setCalloutLineColor(event.target.value)}
                    className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                    aria-label="Line and border color"
                  />
                  <input
                    type="color"
                    value={calloutBoxColor}
                    onChange={(event) => setCalloutBoxColor(event.target.value)}
                    className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                    aria-label="Box color"
                  />
                  <input
                    type="number"
                    min={10}
                    max={48}
                    step={1}
                    value={calloutFontSize}
                    onChange={(event) =>
                      setCalloutFontSize(
                        Math.max(10, Math.min(48, Number(event.target.value) || 18))
                      )
                    }
                    className="h-5 w-12 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                    aria-label="Font size"
                  />
                </div>
                <div
                  className={`h-7 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 transition-opacity ${
                    showLotsControls
                      ? "flex opacity-100"
                      : "hidden pointer-events-none opacity-0"
                  }`}
                  aria-hidden={!showLotsControls}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Lots
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    step={0.01}
                    value={resolvedLongShortLots}
                    onChange={(event) => setLongShortLots(Number(event.target.value))}
                    className="h-5 w-14 rounded border border-border bg-background px-1.5 text-[10px] text-foreground"
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
                <label className="mt-1 flex items-center gap-2 rounded-md px-1 py-1 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={continuousDrawingEnabled}
                    onChange={(event) => setContinuousDrawingEnabled(event.target.checked)}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  <span>Cts draw</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color / lots controls — always visible when active, in both compact and non-compact */}
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
        const showCalloutControls =
          drawingTool === "Callout" || selectedDrawingTool === "Callout";
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
            {showCalloutControls && (
              <div className="flex items-center gap-1 rounded-md border border-border px-2 py-0.5">
                <textarea
                  ref={calloutTextInputRef}
                  value={calloutText}
                  onChange={(event) => setCalloutText(event.target.value)}
                  onKeyDown={handleCalloutTextKeyDown}
                  placeholder="Text"
                  rows={1}
                  className="h-7 w-24 resize-none rounded border border-border bg-background px-1 py-1 text-[10px] leading-[1.2] text-foreground"
                />
                <input
                  type="color"
                  value={calloutTextColor}
                  onChange={(event) => setCalloutTextColor(event.target.value)}
                  className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                  aria-label="Text color"
                />
                <input
                  type="color"
                  value={calloutLineColor}
                  onChange={(event) => setCalloutLineColor(event.target.value)}
                  className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                  aria-label="Line and border color"
                />
                <input
                  type="color"
                  value={calloutBoxColor}
                  onChange={(event) => setCalloutBoxColor(event.target.value)}
                  className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                  aria-label="Box color"
                />
                <input
                  type="number"
                  min={10}
                  max={48}
                  step={1}
                  value={calloutFontSize}
                  onChange={(event) =>
                    setCalloutFontSize(
                      Math.max(10, Math.min(48, Number(event.target.value) || 18))
                    )
                  }
                  className="h-5 w-12 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                  aria-label="Font size"
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
                  value={resolvedLongShortLots}
                  onChange={(event) => setLongShortLots(Number(event.target.value))}
                  className="h-5 w-16 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                />
              </div>
            )}
          </>
        );
      })()}
      </div>

      {!compact ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 max-[480px]:ml-0 max-[480px]:w-full max-[480px]:flex-wrap max-[480px]:pt-1">
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title={isExpanded ? "Exit full screen" : "Full screen"}
            aria-label={isExpanded ? "Exit full screen" : "Full screen"}
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
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title="Fit chart content"
            aria-label="Fit chart content"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              chartRef.current?.removeAllDrawingTools();
              persistCurrentDrawings();
              setDrawingTool(null);
              setSelectedDrawingTool(null);
            }}
            disabled={!selection}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title="Clear drawings"
            aria-label="Clear drawings"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={!selection || isLoading}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-60"
            title="Refresh chart"
            aria-label="Refresh chart"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onTogglePageTabsVisibility}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted"
            title={arePageTabsVisible ? "Hide chart tabs" : "Show chart tabs"}
            aria-label={arePageTabsVisible ? "Hide chart tabs" : "Show chart tabs"}
          >
            {arePageTabsVisible ? (
              <EyeOff className="h-3.5 w-3.5" />
            ) : (
              <Eye className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      ) : (
        /* Compact mode: actions in a popover */
        <div className="relative ml-auto shrink-0" ref={compactActionsRef}>
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
                onClick={() => {
                  chartRef.current?.removeAllDrawingTools();
                  persistCurrentDrawings();
                  setDrawingTool(null);
                  setSelectedDrawingTool(null);
                  setCompactActionsOpen(false);
                }}
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
              <button
                type="button"
                onClick={() => { onTogglePageTabsVisibility?.(); setCompactActionsOpen(false); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-foreground transition-colors hover:bg-accent"
              >
                {arePageTabsVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {arePageTabsVisible ? "Hide Tabs" : "Show Tabs"}
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
      {isAlertFormOpen && (
        <div className="mt-3 rounded-lg border border-border bg-card/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-foreground">Create Price Alert</p>
              <p className="text-xs text-muted-foreground">
                {selection ? `${selection.broker} · ${selection.symbol}` : "Select a symbol first"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAlertFormOpen(false)}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              Close
            </button>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Target Price
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={alertTargetPrice}
                onChange={(event) => setAlertTargetPrice(event.target.value)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Condition
              </span>
              <div className="flex h-9 w-full items-center rounded-md border border-border bg-muted/40 px-3 text-sm text-foreground">
                {formatAlertConditionLabel(alertCondition)}
              </div>
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Price Side
              </span>
              <select
                value={alertPriceSide}
                onChange={(event) => setAlertPriceSide(event.target.value as PriceAlertPriceSide)}
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="bid">Bid</option>
                <option value="ask">Ask</option>
              </select>
            </label>
            <label className="block md:col-span-1">
              <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Note
              </span>
              <input
                type="text"
                value={alertNote}
                onChange={(event) => setAlertNote(event.target.value)}
                placeholder="Optional note"
                className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleCreateAlert()}
              disabled={!selection || alertActionPending}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {alertActionPending ? "Saving..." : "Save Alert"}
            </button>
            <button
              type="button"
              onClick={openAlertForm}
              disabled={!selection}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              Use Current Price
            </button>
            <span className="text-xs text-muted-foreground">
              Current bid {liveBidLabel} · ask {liveAskLabel}
            </span>
          </div>
        </div>
      )}
      {!hasSymbols && (
        <div className="mt-3 rounded-lg border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
          No local symbols found. Sync chart data in settings to populate the dropdown.
        </div>
      )}

      {chartLoadErrorMessage && dismissedChartErrorKey !== chartLoadErrorMessage && (
        <ChartNotice
          tone="error"
          onClose={() => setDismissedChartErrorKey(chartLoadErrorMessage)}
        >
          Failed to load chart data: {chartLoadErrorMessage}
        </ChartNotice>
      )}

      {liveModeIssueMessage && dismissedLiveErrorKey !== liveModeIssueMessage && (
        <ChartNotice
          tone="warning"
          onClose={() => setDismissedLiveErrorKey(liveModeIssueMessage)}
        >
          Live mode issue: {liveModeIssueMessage}
        </ChartNotice>
      )}

      {displayedAlertIssueMessage &&
        (alertActionError || dismissedPriceAlertsErrorKey !== displayedAlertIssueMessage) && (
          <ChartNotice
            tone="error"
            onClose={() => {
              if (alertActionError) {
                setAlertActionError(null);
                return;
              }
              setDismissedPriceAlertsErrorKey(displayedAlertIssueMessage);
            }}
          >
            Alert issue: {displayedAlertIssueMessage}
          </ChartNotice>
        )}

      {alertTriggeredMessage && (
        <ChartNotice
          tone="success"
          onClose={() => setAlertFlashEvent(null)}
        >
          {alertTriggeredMessage}
        </ChartNotice>
      )}

      {tradeActionError && !isRichTradeOpen && (
        <ChartNotice
          tone="error"
          onClose={() => setTradeActionError(null)}
        >
          Trade action issue: {tradeActionError}
        </ChartNotice>
      )}

      <div ref={chartAreaRef} className="mt-3 min-h-[420px] flex-1">
        <TradeCandlestickChart
          ref={chartRef}
          data={displayData}
          replayFutureTimestamps={replayFutureTimestamps}
          timeframe={timeframe}
          timeGuides={timeGuides}
          tradeHistory={displayTradeHistory}
          clipTimeGuideOverlayToPane
          dataUpdateMode={liveVisualsEnabled ? liveDataUpdateMode : dataUpdateMode}
          height={isExpanded ? expandedHeight : chartAreaHeight}
          isLoading={isLoading}
          drawingTool={drawingTool}
          continuousDrawing={continuousDrawingEnabled}
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
            persistCurrentDrawings();
            if (!continuousDrawingEnabled) {
              setDrawingTool(null);
            }
          }}
          onDrawingToolCancel={() => {
            persistCurrentDrawings();
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
          longShortLots={resolvedLongShortLots}
          longShortSymbol={selection?.symbol}
          activeLivePositions={
            liveVisualsEnabled && showLiveTradesOnChart ? livePositions : []
          }
          onActiveLivePositionChange={handleLivePositionAdjust}
          onActiveLivePositionClose={handleLivePositionClose}
          activeLiveOrders={
            liveVisualsEnabled && showLiveTradesOnChart ? liveOrders : []
          }
          onActiveLiveOrderChange={handleLiveOrderAdjust}
          onActiveLiveOrderCancel={handleLiveOrderCancel}
          activePriceAlerts={showAlertsOnChart ? symbolPriceAlerts : []}
          showPriceAlerts={showAlertsOnChart}
          onActivePriceAlertChange={handleAlertChartMove}
          onActivePriceAlertDelete={handleDeleteAlert}
          onCrosshairQuickAlertCreate={handleQuickChartAlertCreate}
          onCrosshairQuickOrderCreate={liveVisualsEnabled ? handleQuickChartOrderCreate : undefined}
          liveBidPrice={liveVisualsEnabled ? liveQuote?.bid ?? null : null}
          liveAskPrice={liveVisualsEnabled ? liveQuote?.ask ?? null : null}
          showCandleCountdown={liveVisualsEnabled && liveCurrentBar != null}
          candleCountdownAnchorTimestamp={liveVisualsEnabled ? liveCurrentBar?.timestamp ?? null : null}
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

