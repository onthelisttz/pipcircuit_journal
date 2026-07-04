"use client";

import {
    createChart,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type CandlestickData,
    type WhitespaceData,
    type Time,
    ColorType,
    LineStyle,
    CandlestickSeries,
    CrosshairMode,
} from "lightweight-charts";
import {
    useEffect,
    useRef,
    useCallback,
    useState,
    forwardRef,
    memo,
    useImperativeHandle,
    useMemo,
    type PointerEvent as ReactPointerEvent,
    type MouseEvent as ReactMouseEvent,
} from "react";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { estimateGrossProfit, volumeToLots, priceDiffToPips } from "@lib/pnl-estimate";
import { RiskRewardPlugin, type RiskRewardLabels } from "./plugins/RiskRewardPlugin";
import { createLineToolsPlugin } from "lightweight-charts-line-tools-core";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { registerLinesPlugin } from "lightweight-charts-line-tools-lines";
import { registerPathPlugin } from "lightweight-charts-line-tools-path";
import { StableLongShortPosition, defaultLongShortWidthSeconds } from "./plugins/StableLongShortPosition";
import { PreciseBrushTool } from "./plugins/PreciseBrushTool";
import { GanLevelsTool } from "./plugins/GanLevelsTool";
import {
    buildTimeGuides,
    type TimeGuideSettings,
} from "./timeGuides";
import { findReplayStartIndex } from "./replay";
import type { PriceAlert, PriceAlertPriceSide } from "@ui/hooks/usePriceAlerts";

export type DrawingToolType =
    | "Path"
    | "Brush"
    | "Gan"
    | "TrendLine"
    | "HorizontalRay"
    | "Rectangle"
    | "LongShortPosition"
    | "Callout";
type LineToolsApi = ReturnType<typeof createLineToolsPlugin>;
type ChartMouseEventHandler = Parameters<IChartApi["subscribeClick"]>[0];
type ChartMouseEventParam = ChartMouseEventHandler extends (param: infer P) => void ? P : never;
type DrawingPoint = { timestamp: number; price: number };
type DrawingToolExport = {
    id: string;
    toolType: DrawingToolType;
    points: DrawingPoint[];
    options?: Record<string, unknown>;
};
type SelectionBoxBounds = {
    left: number;
    top: number;
    width: number;
    height: number;
};
type InternalLineTool = {
    id: () => string;
    getExportData: () => DrawingToolExport;
    isSelected: () => boolean;
    setSelected: (selected: boolean) => void;
};
type LineToolsInternalApi = LineToolsApi & {
    _tools?: Map<string, InternalLineTool>;
    _interactionManager?: {
        _currentToolCreating?: InternalLineTool | null;
        _draggedPointIndex?: number | null;
        _hitTest?: (point: { x: number; y: number }) => { tool: InternalLineTool } | null;
        _selectedTool?: InternalLineTool | null;
        screenPointToLineToolPoint?: (point: { x: number; y: number }) => DrawingPoint | null;
        setCurrentToolCreating?: (tool: InternalLineTool | null) => void;
        deselectAllTools?: () => void;
    };
    requestUpdate?: () => void;
};

const EMPTY_REPLAY_FUTURE_TIMESTAMPS: number[] = [];
const LONG_SHORT_DRAWING_META_KEY = "__personalJournal";

function isDrawingToolType(toolType: string): toolType is DrawingToolType {
    return (
        toolType === "Rectangle" ||
        toolType === "TrendLine" ||
        toolType === "Path" ||
        toolType === "Brush" ||
        toolType === "Gan" ||
        toolType === "HorizontalRay" ||
        toolType === "LongShortPosition" ||
        toolType === "Callout"
    );
}

function areLongShortLabelsVisible(options?: Record<string, unknown>): boolean {
    const meta = options?.[LONG_SHORT_DRAWING_META_KEY];
    return (
        meta != null &&
        typeof meta === "object" &&
        (meta as { labelsVisible?: unknown }).labelsVisible === true
    );
}

function withLongShortLabelsVisible(
    options: Record<string, unknown> | undefined,
    labelsVisible: boolean
): Record<string, unknown> {
    const meta =
        options?.[LONG_SHORT_DRAWING_META_KEY] != null &&
        typeof options[LONG_SHORT_DRAWING_META_KEY] === "object"
            ? (options[LONG_SHORT_DRAWING_META_KEY] as Record<string, unknown>)
            : {};

    return {
        ...(options ?? {}),
        [LONG_SHORT_DRAWING_META_KEY]: {
            ...meta,
            labelsVisible,
        },
    };
}

function buildCalloutTextOptions(config: {
    text: string;
    fontSize: number;
    textColor: string;
    boxColor: string;
    lineColor: string;
}) {
    return {
        value: config.text.trim() || "Text",
        // Let short labels size to content instead of forcing a wide box.
        wordWrapWidth: 0,
        font: {
            size: Math.max(10, Math.round(config.fontSize || 14)),
            color: config.textColor || "#ffffff",
        },
        // Keep padding visually tight and stable as font size changes.
        box: {
            border: {
                color: config.lineColor || "#8b5cf6",
                radius: 10,
            },
            background: {
                color: config.boxColor || "#134985",
                inflation: { x: 1, y: 2 },
            },
            padding: { x: 1, y: 2 },
        },
    };
}

function timeframeToSeconds(timeframe?: ChartTimeframe): number {
    switch (timeframe) {
        case "M1":
            return 60;
        case "M5":
            return 5 * 60;
        case "M15":
            return 15 * 60;
        case "M30":
            return 30 * 60;
        case "H1":
            return 60 * 60;
        case "H4":
            return 4 * 60 * 60;
        case "D1":
            return 24 * 60 * 60;
        default:
            return 60;
    }
}

function formatCandleCountdown(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }

    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatPriceScaleLabel(price: number, precision: number): string {
    return price.toLocaleString(undefined, {
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
    });
}

function timeToDate(time: unknown): Date | null {
    if (typeof time === "number") {
        return new Date(time * 1000);
    }
    if (typeof time === "string") {
        return new Date(time);
    }
    if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
        const businessDay = time as { year: number; month: number; day: number };
        return new Date(Date.UTC(businessDay.year, businessDay.month - 1, businessDay.day));
    }
    return null;
}

function formatInChartTimezone(
    date: Date,
    options: Intl.DateTimeFormatOptions
): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        hour12: false,
        ...options,
    }).format(date);
}

function normalizeSelectionBox(
    startPoint: { x: number; y: number },
    endPoint: { x: number; y: number }
): SelectionBoxBounds {
    const left = Math.min(startPoint.x, endPoint.x);
    const top = Math.min(startPoint.y, endPoint.y);
    const right = Math.max(startPoint.x, endPoint.x);
    const bottom = Math.max(startPoint.y, endPoint.y);

    return {
        left,
        top,
        width: right - left,
        height: bottom - top,
    };
}

function selectionBoxesIntersect(first: SelectionBoxBounds, second: SelectionBoxBounds): boolean {
    return (
        first.left <= second.left + second.width &&
        first.left + first.width >= second.left &&
        first.top <= second.top + second.height &&
        first.top + first.height >= second.top
    );
}

function drawingTimestampToChartTime(timestamp: number): Time {
    const seconds = timestamp >= 1_000_000_000_000 ? timestamp / 1000 : timestamp;
    return seconds as Time;
}

function isSelectionModifierPressed(event: Pick<PointerEvent, "ctrlKey" | "metaKey" | "shiftKey">): boolean {
    return event.ctrlKey || event.metaKey || event.shiftKey;
}

function isPrimaryDrawingPointer(event: PointerEvent): boolean {
    if (!event.isPrimary) return false;
    if (event.pointerType === "mouse") {
        return event.button === 0;
    }
    return event.buttons === 1 || event.button === 0 || event.button === -1;
}

type TradeOverlayData = {
    entryPrice: number;
    rewardPrice: number;
    scaledRiskPrice: number;
    startTs: Time;
    endTs: Time | null;
    isBuy: boolean;
    useMae: boolean;
    labels: RiskRewardLabels;
};

export interface ActiveLivePosition {
    positionId: string;
    symbol: string;
    direction: "Buy" | "Sell";
    lots: number;
    openTimestamp: number | null;
    entryPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
}

export interface ActiveLiveOrder {
    orderId: string;
    symbol: string;
    direction: "Buy" | "Sell";
    orderType: string;
    lots: number;
    limitPrice: number | null;
    stopPrice: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
    createdAt?: number | null;
}

const LIVE_TRADE_TOOL_ID_PREFIX = "live-trade:";

function isLiveTradeToolId(id: string): boolean {
    return id.startsWith(LIVE_TRADE_TOOL_ID_PREFIX);
}

type LiveTradeLineMeta =
    | {
          kind: "position-stopLoss" | "position-takeProfit";
          positionId: string;
      }
    | {
          kind: "order-entry" | "order-stopLoss" | "order-takeProfit";
          orderId: string;
          orderType: string;
      }
    | {
          kind: "alert-target";
          alertId: string;
          priceSide: PriceAlertPriceSide;
      };

type LiveTradeLineSpec = {
    id: string;
    price: number;
    title: string;
    color: string;
    lineStyle: LineStyle;
    editable: boolean;
    toolMeta?: LiveTradeLineMeta;
};

type LiveTradeOverlayItem = {
    id: string;
    lineType: "position-entry" | "position-sl" | "position-tp" | "order-entry" | "order-sl" | "order-tp" | "alert-target";
    y: number;
    color: string;
    lotsLabel: string;
    label: string;
    pipsLabel?: string;
    pipsPositive?: boolean;
    pnlLabel?: string;
    pnlPositive?: boolean;
    currentPnlLabel?: string;
    currentPnlPositive?: boolean;
    draggable: boolean;
    dragToolId?: string;
    positionId?: string;
    orderId?: string;
    showTpToggle?: boolean;
    showSlToggle?: boolean;
    tpDragToolId?: string;
    slDragToolId?: string;
    hasTp?: boolean;
    hasSl?: boolean;
    alertId?: string;
};

type LiveTradeHtmlDragSession = {
    toolId: string;
};

type CrosshairQuickOrderSide = "BUY" | "SELL";
type CrosshairQuickOrderType = "LIMIT" | "STOP";
type CrosshairQuickActionState = {
    y: number;
    price: number;
};

function formatLiveTradeTitle(lots: number, text: string): string {
    const normalizedLots = Number.isFinite(lots) && lots > 0 ? lots.toFixed(2) : "0.00";
    return `${normalizedLots} ${text}`;
}

function formatLiveTradeLotsLabel(lots: number): string {
    if (!Number.isFinite(lots) || lots <= 0) return "0.00";
    return lots.toLocaleString(undefined, {
        minimumFractionDigits: lots >= 10 ? 0 : 2,
        maximumFractionDigits: 2,
    });
}

function formatLiveOrderLabel(direction: string, orderType: string): string {
    const normalizedType = String(orderType ?? "").trim().toUpperCase();
    const shortType = normalizedType.includes("LIMIT")
        ? "Limit"
        : normalizedType.includes("STOP")
            ? "Stop"
            : orderType;
    return `${direction} ${shortType}`.trim();
}

function formatAlertCondition(condition: PriceAlert["condition"]): string {
    return condition === "below" ? "Cross Below" : "Cross Above";
}

function getCrosshairQuickOrderType(
    side: CrosshairQuickOrderSide,
    targetPrice: number,
    bidPrice: number | null,
    askPrice: number | null
): CrosshairQuickOrderType {
    if (side === "BUY") {
        const buyReference = Number.isFinite(askPrice) ? askPrice : bidPrice;
        if (buyReference == null || !Number.isFinite(buyReference)) {
            return "LIMIT";
        }
        return targetPrice <= buyReference ? "LIMIT" : "STOP";
    }

    const sellReference = Number.isFinite(bidPrice) ? bidPrice : askPrice;
    if (sellReference == null || !Number.isFinite(sellReference)) {
        return "LIMIT";
    }
    return targetPrice >= sellReference ? "LIMIT" : "STOP";
}

function withColorAlpha(color: string, alpha: number): string {
    const normalizedAlpha = Math.max(0, Math.min(1, alpha));
    const rgbaMatch = color.match(/^rgba?\(([^)]+)\)$/i);
    if (!rgbaMatch) {
        return color;
    }

    const parts = rgbaMatch[1]
        .split(",")
        .map((part) => Number.parseFloat(part.trim()))
        .filter((value) => Number.isFinite(value));
    if (parts.length < 3) {
        return color;
    }

    const [red, green, blue] = parts;
    return `rgba(${red}, ${green}, ${blue}, ${normalizedAlpha})`;
}

function formatLivePipsLabel(value: number): string {
    if (!Number.isFinite(value)) return "0.0p";
    const rounded = Math.round(value * 10) / 10;
    const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
    return `${sign}${Math.abs(rounded).toFixed(1)}p`;
}

function formatLiveMoneyLabel(value: number): string {
    if (!Number.isFinite(value)) return "$0.00";
    const sign = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function buildTradeOverlay(
    trade: Trade,
    data: ChartBar[],
    showLabels: boolean
): TradeOverlayData | null {
    if (data.length === 0) return null;

    const isBuy = trade.direction === Direction.Buy;
    const symbol = trade.symbol ?? "";
    const rawEntry = trade.entryPrice ?? trade.openPrice;
    const rawReward = trade.closePrice ?? trade.takeProfit;
    const rawStopLoss = trade.stopLoss;

    if (
        rawEntry == null ||
        rawReward == null ||
        !Number.isFinite(rawEntry) ||
        !Number.isFinite(rawReward)
    ) {
        return null;
    }

    let entryPrice = rawEntry;
    let rewardPrice = rawReward;
    let stopLoss = rawStopLoss;

    const openTs = new Date(trade.openTime).getTime();
    const closeTs = trade.closeTime ? new Date(trade.closeTime).getTime() : null;
    const dataEndTs = data.length > 0 ? Math.max(...data.map((bar) => bar.timestamp)) : openTs;
    const endTs = closeTs ?? dataEndTs;
    const tradeBars = data.filter((bar) => bar.timestamp >= openTs && bar.timestamp <= endTs);
    const allBarsFromOpen = data.filter((bar) => bar.timestamp >= openTs);

    let rawMaePrice: number | null = null;
    const barsForMae = tradeBars.length > 0 ? tradeBars : allBarsFromOpen;
    if (barsForMae.length > 0) {
        rawMaePrice = isBuy
            ? Math.min(...barsForMae.map((bar) => bar.low))
            : Math.max(...barsForMae.map((bar) => bar.high));
    }

    const actualProfit = trade.netProfit ?? trade.grossProfit;
    const isClosedTrade = trade.closeTime != null && actualProfit != null && Number.isFinite(actualProfit);
    const isWinningTrade = isClosedTrade && (actualProfit ?? 0) > 0;
    const hasExplicitSL = stopLoss != null && Number.isFinite(stopLoss);
    const hasMae = rawMaePrice != null && Number.isFinite(rawMaePrice);
    const useMae = hasMae && !hasExplicitSL && (!isClosedTrade || isWinningTrade);
    const showRiskZone = hasExplicitSL || useMae;

    const avgPrice = data.reduce((sum, bar) => sum + bar.close, 0) / data.length;
    if (entryPrice && avgPrice > 0) {
        const ratio = avgPrice / entryPrice;
        const logDiff = Math.log10(ratio);
        const magnitude = Math.round(logDiff);

        if (Math.abs(magnitude) >= 1) {
            const multiplier = Math.pow(10, magnitude);
            entryPrice = entryPrice * multiplier;
            rewardPrice = rewardPrice * multiplier;
            if (stopLoss != null) stopLoss = stopLoss * multiplier;
        }
    }

    const scaledRiskPrice =
        hasExplicitSL && stopLoss != null
            ? stopLoss
            : useMae && rawMaePrice != null
                ? rawMaePrice
                : entryPrice;

    const lots = (trade.lots ?? volumeToLots(trade.volume ?? 0, symbol)) || 0.01;
    const direction = isBuy ? "Buy" : "Sell";
    const rawRiskPrice = hasExplicitSL
        ? rawStopLoss
        : useMae
            ? rawMaePrice
            : null;

    let riskLabel: string | undefined;
    if (showLabels && showRiskZone && rawRiskPrice != null) {
        const riskDollar = estimateGrossProfit(rawEntry, rawRiskPrice, lots, direction, symbol);
        if (Number.isFinite(riskDollar) && Math.abs(riskDollar) < 1_000_000) {
            riskLabel = `${riskDollar >= 0 ? "+" : ""}$${riskDollar.toFixed(2)}`;
        }
    }

    let rewardLabel: string | undefined;
    if (showLabels && actualProfit != null && Number.isFinite(actualProfit) && Math.abs(actualProfit) < 1_000_000) {
        rewardLabel = `${actualProfit >= 0 ? "+" : ""}$${actualProfit.toFixed(2)}`;
    } else if (showLabels) {
        const rewardDollar = estimateGrossProfit(rawEntry, rawReward, lots, direction, symbol);
        if (Number.isFinite(rewardDollar) && Math.abs(rewardDollar) < 1_000_000) {
            rewardLabel = `${rewardDollar >= 0 ? "+" : ""}$${rewardDollar.toFixed(2)}`;
        }
    }

    const profitLabel =
        showLabels && actualProfit != null && Number.isFinite(actualProfit)
            ? `${actualProfit >= 0 ? "+" : ""}$${actualProfit.toFixed(2)}`
            : undefined;

    const findClosestTime = (targetDate: Date | string | number): Time => {
        const targetTs = new Date(targetDate).getTime();
        const closest = data.reduce((prev, curr) =>
            Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev
        );
        return (closest.timestamp / 1000) as Time;
    };

    return {
        entryPrice,
        rewardPrice,
        scaledRiskPrice,
        startTs: findClosestTime(trade.openTime),
        endTs: trade.closeTime ? findClosestTime(trade.closeTime) : null,
        isBuy,
        useMae,
        labels: {
            riskLabel,
            rewardLabel,
            profitLabel,
            isProfit: (trade.netProfit ?? trade.grossProfit ?? 0) >= 0,
        },
    };
}

function formatCrosshairDateTime(time: unknown): string {
    const date = timeToDate(time);
    if (!date) {
        return String(time ?? "");
    }

    return formatInChartTimezone(date, {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function normalizeInstrumentSymbol(symbol?: string): string {
    return (symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function countFractionDigits(value: number): number {
    if (!Number.isFinite(value)) return 0;

    const text = value.toString().toLowerCase();
    if (text.includes("e-")) {
        const [, exponentText] = text.split("e-");
        const exponent = Number(exponentText);
        return Number.isFinite(exponent) ? exponent : 0;
    }

    const decimalPart = text.split(".")[1];
    return decimalPart ? decimalPart.length : 0;
}

function inferPricePrecision(symbol: string | undefined, bars: ChartBar[]): number {
    const normalizedSymbol = normalizeInstrumentSymbol(symbol);
    const symbolPrecision =
        normalizedSymbol.includes("JPY") ? 3 :
        /^[A-Z]{6}$/.test(normalizedSymbol) ? 5 :
        normalizedSymbol.startsWith("XAU") || normalizedSymbol === "GOLD" ? 2 :
        null;

    let dataPrecision = 0;
    const sampleSize = Math.min(bars.length, 200);
    for (let index = 0; index < sampleSize; index += 1) {
        const bar = bars[index];
        dataPrecision = Math.max(
            dataPrecision,
            countFractionDigits(bar.open),
            countFractionDigits(bar.high),
            countFractionDigits(bar.low),
            countFractionDigits(bar.close)
        );
    }

    const inferred = symbolPrecision == null ? dataPrecision : Math.max(symbolPrecision, dataPrecision);
    return Math.min(6, Math.max(0, inferred || 2));
}

function buildSeriesPriceFormat(symbol: string | undefined, bars: ChartBar[]) {
    const precision = inferPricePrecision(symbol, bars);
    return {
        type: "price" as const,
        precision,
        minMove: 1 / Math.pow(10, precision),
    };
}

function sameTimeGuideOverlay(
    left: {
        width: number | null;
        height: number | null;
        verticalLines: Array<{ id: string; kind: "daily" | "session" | "marker"; x: number }>;
    },
    right: {
        width: number | null;
        height: number | null;
        verticalLines: Array<{ id: string; kind: "daily" | "session" | "marker"; x: number }>;
    }
): boolean {
    if (left.width !== right.width || left.height !== right.height) return false;
    if (left.verticalLines.length !== right.verticalLines.length) return false;

    for (let index = 0; index < left.verticalLines.length; index += 1) {
        const a = left.verticalLines[index];
        const b = right.verticalLines[index];
        if (a.id !== b.id || a.kind !== b.kind || Math.abs(a.x - b.x) > 0.5) {
            return false;
        }
    }

    return true;
}

export interface TradeCandlestickChartProps {
    /** Chart bar data to display */
    data: ChartBar[];
    /** Future timestamps to keep as blank space during replay */
    replayFutureTimestamps?: number[];
    /** Extra empty space on the right side, expressed in bars */
    replayRightOffsetBars?: number;
    /** Timeframe of the current bar set */
    timeframe?: ChartTimeframe;
    /** Optional time-based guide settings */
    timeGuides?: TimeGuideSettings;
    /** Trade for context visualization */
    trade?: Trade;
    /** Additional trades to render as history overlays */
    tradeHistory?: Trade[];
    /** Height of the chart container */
    height?: number;
    /** Show entry marker on chart */
    showEntryMarker?: boolean;
    /** Show exit marker on chart */
    showExitMarker?: boolean;
    /** Callback when visible range changes (for lazy loading) */
    onVisibleRangeChange?: (from: number, to: number) => void;
    /** Loading state */
    isLoading?: boolean;
    /** Active drawing tool - when set, starts interactive drawing mode */
    drawingTool?: DrawingToolType | null;
    /** Keep the active drawing tool armed after each completed drawing */
    continuousDrawing?: boolean;
    /** Line color for Path/TrendLine tools (e.g., rgba or hex) */
    drawingLineColor?: string;
    /** Rectangle tool background color (e.g., rgba or hex) */
    rectangleFillColor?: string;
    /** Rectangle tool border color */
    rectangleBorderColor?: string;
    /** Text content used when creating or editing Callout notes */
    calloutText?: string;
    /** Font size used when creating or editing Callout notes */
    calloutFontSize?: number;
    /** Text color used when creating or editing Callout notes */
    calloutTextColor?: string;
    /** Shared accent color used for the Callout line and border */
    calloutLineColor?: string;
    /** Box background used when creating or editing Callout notes */
    calloutBoxColor?: string;
    /** Lot size for Long/Short tool P&L */
    longShortLots?: number;
    /** Symbol for Long/Short tool P&L and pips */
    longShortSymbol?: string;
    /** Temporarily hide user drawings without clearing them */
    drawingsHidden?: boolean;
    /** Notify when a drawing tool is selected */
    onDrawingSelectionChange?: (selectedTool: DrawingToolType | null) => void;
    /** Notify when interactive drawing finishes so parent can exit tool mode */
    onDrawingToolComplete?: (tool: DrawingToolType) => void;
    /** Notify when drawing mode should be cancelled and return to normal cursor state */
    onDrawingToolCancel?: () => void;
    /** Notify when a rectangle is selected/deselected */
    onRectangleSelectionChange?: (selected: boolean) => void;
    /** Notify when a Callout should enter edit mode in the parent UI */
    onCalloutEditRequest?: () => void;
    /** Show automatic risk/reward zones from trade data */
    showRiskReward?: boolean;
    /** Show risk/reward text labels (e.g. +$7.00 / -$9.00) */
    showRiskRewardLabels?: boolean;
    /** Auto-fit/scroll when data updates */
    autoScrollOnData?: boolean;
    /** Default zoom-out level used when centering trade */
    zoomOutMultiplier?: number;
    /** Hint for how incoming data changed so large history updates can stay incremental */
    dataUpdateMode?: "auto" | "replace" | "append" | "prepend";
    /** Restrict HTML time-guide overlays to the pane so they don't cover the price scale */
    clipTimeGuideOverlayToPane?: boolean;
    /** When true, moving the crosshair previews a replay start position */
    replayPlacementMode?: boolean;
    /** Timestamp currently previewed for replay placement */
    replayPlacementTimestamp?: number | null;
    /** Notify parent when replay placement preview changes */
    onReplayPlacementPreviewChange?: (timestamp: number | null) => void;
    /** Notify parent when replay placement is selected via chart click */
    onReplayPlacementSelect?: (timestamp: number) => void;
    /** Active live positions rendered as chart-managed long/short tools */
    activeLivePositions?: ActiveLivePosition[];
    /** Called when a live position's SL/TP is dragged on chart */
    onActiveLivePositionChange?: (positionId: string, stopLoss?: number | null, takeProfit?: number | null) => void;
    /** Called when a live position should be closed from the chart overlay */
    onActiveLivePositionClose?: (positionId: string) => void;
    /** Active live pending orders rendered as draggable chart lines */
    activeLiveOrders?: ActiveLiveOrder[];
    /** Called when a live pending order line is dragged on chart */
    onActiveLiveOrderChange?: (
        orderId: string,
        patch: {
            limitPrice?: number | null;
            stopPrice?: number | null;
            stopLoss?: number | null;
            takeProfit?: number | null;
        }
    ) => void;
    /** Called when a live pending order should be cancelled from the chart overlay */
    onActiveLiveOrderCancel?: (orderId: string) => void;
    /** Active price alerts rendered as draggable alert lines */
    activePriceAlerts?: PriceAlert[];
    /** When false, alert lines are hidden even if alerts exist */
    showPriceAlerts?: boolean;
    /** Called when an alert target is dragged on chart */
    onActivePriceAlertChange?: (alertId: string, targetPrice: number, priceSide: PriceAlertPriceSide) => void;
    /** Called when an alert should be deleted from the chart overlay */
    onActivePriceAlertDelete?: (alertId: string) => void;
    /** Called when a crosshair quick alert action is chosen */
    onCrosshairQuickAlertCreate?: (targetPrice: number) => void;
    /** Called when a crosshair quick pending-order action is chosen */
    onCrosshairQuickOrderCreate?: (side: CrosshairQuickOrderSide, orderType: CrosshairQuickOrderType, targetPrice: number) => void;
    /** Optional live bid price line */
    liveBidPrice?: number | null;
    /** Optional live ask price line */
    liveAskPrice?: number | null;
    /** When true, show a live candle countdown overlay */
    showCandleCountdown?: boolean;
    /** Start timestamp for the currently forming candle */
    candleCountdownAnchorTimestamp?: number | null;
    /** Optional timestamp to jump to when the End key is pressed */
    endKeyScrollTargetTimestamp?: number | null;
    /** When true, show a vertical marker line at markerTimestamp */
    showMarker?: boolean;
    /** Timestamp for the marker line */
    markerTimestamp?: number;
    /** Called when a trade history overlay is clicked on the chart */
    onTradeHistoryClick?: (trade: Trade) => void;
    /** Trade history ID to highlight and auto-scroll to */
    selectedTradeHistoryId?: number | null;
}

function sameReplayPlacementOverlay(
    left: {
        width: number | null;
        height: number | null;
        x: number | null;
    },
    right: {
        width: number | null;
        height: number | null;
        x: number | null;
    }
): boolean {
    const xMatches =
        left.x === right.x ||
        (left.x != null && right.x != null && Math.abs(left.x - right.x) <= 0.5);
    return left.width === right.width && left.height === right.height && xMatches;
}

function sameCandleCountdownOverlay(
    left: {
        top: number | null;
        right: number | null;
    },
    right: {
        top: number | null;
        right: number | null;
    }
): boolean {
    const topMatches =
        left.top === right.top ||
        (left.top != null && right.top != null && Math.abs(left.top - right.top) <= 0.5);
    return topMatches && left.right === right.right;
}

function sameLiveTradeOverlayItems(left: LiveTradeOverlayItem[], right: LiveTradeOverlayItem[]): boolean {
    if (left.length !== right.length) return false;

    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (
            a.id !== b.id ||
            a.lineType !== b.lineType ||
            a.label !== b.label ||
            a.lotsLabel !== b.lotsLabel ||
            a.color !== b.color ||
            a.pipsLabel !== b.pipsLabel ||
            a.pipsPositive !== b.pipsPositive ||
            a.pnlLabel !== b.pnlLabel ||
            a.pnlPositive !== b.pnlPositive ||
            a.currentPnlLabel !== b.currentPnlLabel ||
            a.currentPnlPositive !== b.currentPnlPositive ||
            a.draggable !== b.draggable ||
            a.dragToolId !== b.dragToolId ||
            a.positionId !== b.positionId ||
            a.orderId !== b.orderId ||
            a.alertId !== b.alertId ||
            a.showTpToggle !== b.showTpToggle ||
            a.showSlToggle !== b.showSlToggle ||
            a.hasTp !== b.hasTp ||
            a.hasSl !== b.hasSl
        ) {
            return false;
        }

        const yMatches = a.y === b.y || Math.abs(a.y - b.y) <= 0.5;
        if (!yMatches) {
            return false;
        }
    }

    return true;
}

export interface TradeCandlestickChartRef {
    fitContent: () => void;
    setHighlightedTradeId: (tradeId: number | null) => void;
    scrollToTrade: (zoomOutMultiplier?: number) => void;
    removeAllDrawingTools: () => void;
    deleteSelectedDrawings: () => void;
    cancelActiveDrawing: () => void;
    exportAllDrawings: () => DrawingToolExport[];
    importDrawings: (drawings: DrawingToolExport[]) => void;
    getViewportCenterTimestamp: () => number | null;
    getVisibleWindowSeconds: () => number | null;
    getVisibleLogicalRange: () => { from: number; to: number } | null;
    setVisibleLogicalRange: (range: { from: number; to: number }) => void;
    scrollToTimestamp: (timestamp: number, windowSeconds?: number) => void;
    getSelectedCalloutConfig: () => {
        text: string;
        fontSize: number;
        textColor: string;
        lineColor: string;
        boxColor: string;
    } | null;
    updateSelectedCallout: (config: {
        text?: string;
        fontSize?: number;
        textColor?: string;
        lineColor?: string;
        boxColor?: string;
    }) => void;
}

/**
 * TradeCandlestickChart - Main candlestick chart component
 *
 * Uses TradingView Lightweight Charts v5 with dark theme (Pure Black),
 * R:R visualization with timestamp snapping for finite boxes.
 */
const TradeCandlestickChartInner = forwardRef<TradeCandlestickChartRef, TradeCandlestickChartProps>(function TradeCandlestickChart({
    data,
    replayFutureTimestamps = EMPTY_REPLAY_FUTURE_TIMESTAMPS,
    replayRightOffsetBars = 0,
    timeframe,
    timeGuides,
    trade,
    tradeHistory,
    height = 400,
    onVisibleRangeChange,
    isLoading = false,
    drawingTool = null,
    continuousDrawing = false,
    drawingLineColor,
    rectangleFillColor,
    rectangleBorderColor,
    calloutText = "Text",
    calloutFontSize = 18,
    calloutTextColor = "#00ff66",
    calloutLineColor = "#00ff66",
    calloutBoxColor = "rgba(0,0,0,0.88)",
    longShortLots = 1,
    longShortSymbol,
    drawingsHidden = false,
    onDrawingSelectionChange,
    onDrawingToolComplete,
    onDrawingToolCancel,
    onRectangleSelectionChange,
    onCalloutEditRequest,
    showRiskReward = true,
    showRiskRewardLabels = true,
    autoScrollOnData = true,
    zoomOutMultiplier = 3.2,
    dataUpdateMode = "auto",
    clipTimeGuideOverlayToPane = false,
    replayPlacementMode = false,
    replayPlacementTimestamp = null,
    onReplayPlacementPreviewChange,
    onReplayPlacementSelect,
    activeLivePositions = [],
    onActiveLivePositionChange,
    onActiveLivePositionClose,
    activeLiveOrders = [],
    onActiveLiveOrderChange,
    onActiveLiveOrderCancel,
    activePriceAlerts = [],
    showPriceAlerts = true,
    onActivePriceAlertChange,
    onActivePriceAlertDelete,
    onCrosshairQuickAlertCreate,
    onCrosshairQuickOrderCreate,
    onTradeHistoryClick,
    selectedTradeHistoryId,
    liveBidPrice = null,
    liveAskPrice = null,
    showCandleCountdown = false,
    candleCountdownAnchorTimestamp = null,
    endKeyScrollTargetTimestamp = null,
    showMarker = false,
    markerTimestamp,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const exitLineRef = useRef<IPriceLine | null>(null);
    const liveBidLineRef = useRef<IPriceLine | null>(null);
    const liveAskLineRef = useRef<IPriceLine | null>(null);
    const liveTradePriceLinesRef = useRef<Map<string, IPriceLine>>(new Map());
    const activeLivePositionsRef = useRef(activeLivePositions);
    const activeLiveOrdersRef = useRef(activeLiveOrders);
    const activePriceAlertsRef = useRef(activePriceAlerts);
    const priceScaleUnlockFrameRef = useRef<number | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [countdownNow, setCountdownNow] = useState(() => Date.now());
    const [timeGuideOverlay, setTimeGuideOverlay] = useState<{
        width: number | null;
        height: number | null;
        verticalLines: Array<{ id: string; kind: "daily" | "session" | "marker"; x: number }>;
    }>({
        width: null,
        height: null,
        verticalLines: [],
    });
    const [markerOverlay, setMarkerOverlay] = useState<{
        width: number | null;
        height: number | null;
        x: number | null;
    }>({
        width: null,
        height: null,
        x: null,
    });
    const [replayPlacementOverlay, setReplayPlacementOverlay] = useState<{
        width: number | null;
        height: number | null;
        x: number | null;
    }>({
        width: null,
        height: null,
        x: null,
    });
    const [candleCountdownOverlay, setCandleCountdownOverlay] = useState<{
        top: number | null;
        right: number | null;
    }>({
        top: null,
        right: null,
    });
    const [liveTradeOverlayItems, setLiveTradeOverlayItems] = useState<LiveTradeOverlayItem[]>([]);
    const [liveTradeOverlayPadRight, setLiveTradeOverlayPadRight] = useState(0);
    const [liveTradePreviewPrices, setLiveTradePreviewPrices] = useState<Record<string, number>>({});
    const [liveTradeDragSession, setLiveTradeDragSession] = useState<LiveTradeHtmlDragSession | null>(null);
    const [crosshairQuickAction, setCrosshairQuickAction] = useState<CrosshairQuickActionState | null>(null);
    const [isCrosshairQuickMenuOpen, setIsCrosshairQuickMenuOpen] = useState(false);
    const [selectionBox, setSelectionBox] = useState<SelectionBoxBounds | null>(null);
    const onVisibleRangeChangeRef = useRef<typeof onVisibleRangeChange>(onVisibleRangeChange);
    const onDrawingSelectionChangeRef = useRef<typeof onDrawingSelectionChange>(onDrawingSelectionChange);
    const onDrawingToolCompleteRef = useRef<typeof onDrawingToolComplete>(onDrawingToolComplete);
    const onDrawingToolCancelRef = useRef<typeof onDrawingToolCancel>(onDrawingToolCancel);
    const onRectangleSelectionChangeRef = useRef<typeof onRectangleSelectionChange>(onRectangleSelectionChange);
    const onCalloutEditRequestRef = useRef<typeof onCalloutEditRequest>(onCalloutEditRequest);
    const onReplayPlacementPreviewChangeRef = useRef<typeof onReplayPlacementPreviewChange>(onReplayPlacementPreviewChange);
    const onReplayPlacementSelectRef = useRef<typeof onReplayPlacementSelect>(onReplayPlacementSelect);
    const replayPlacementModeRef = useRef<boolean>(replayPlacementMode);
    const replayPlacementTimestampRef = useRef<number | null>(replayPlacementTimestamp);
    const prevBarsRef = useRef<ChartBar[]>([]);
    const dataRef = useRef<ChartBar[]>(data);
    const suppressVisibleRangeUntilRef = useRef(0);

    const riskRewardPluginRef = useRef<RiskRewardPlugin | null>(null);
    const tradeHistoryPluginsRef = useRef<RiskRewardPlugin[]>([]);
    const lineToolsRef = useRef<LineToolsApi | null>(null);
    const lastSelectedDrawingRef = useRef<{ id: string; toolType: DrawingToolType } | null>(null);
    const drawingToolRef = useRef<DrawingToolType | null>(drawingTool);
    const continuousDrawingRef = useRef<boolean>(continuousDrawing);
    const skipNextCancelActiveDrawingRef = useRef(false);
    const drawingLineColorRef = useRef<string | undefined>(drawingLineColor);
    const rectangleFillColorRef = useRef<string | undefined>(rectangleFillColor);
    const rectangleBorderColorRef = useRef<string | undefined>(rectangleBorderColor);
    const calloutTextRef = useRef<string>(calloutText);
    const calloutFontSizeRef = useRef<number>(calloutFontSize);
    const calloutTextColorRef = useRef<string>(calloutTextColor);
    const calloutLineColorRef = useRef<string>(calloutLineColor);
    const calloutBoxColorRef = useRef<string>(calloutBoxColor);
    const longShortLotsRef = useRef<number>(longShortLots);
    const longShortSymbolRef = useRef<string | undefined>(longShortSymbol);
    const drawingsHiddenRef = useRef<boolean>(drawingsHidden);
    const hiddenDrawingsRef = useRef<DrawingToolExport[]>([]);
    const heightRef = useRef<number>(height);
    const overlayFrameRef = useRef<number | null>(null);
    const scheduleTimeGuideOverlayRefreshRef = useRef<() => void>(() => {});
    const scheduleReplayPlacementOverlayRefreshRef = useRef<() => void>(() => {});
    const syncLongShortLabelVisibilityRef = useRef<() => void>(() => {});
    const selectedDrawingIdsRef = useRef<string[]>([]);
    const selectionSnapshotRef = useRef<Map<string, DrawingToolExport> | null>(null);
    const duplicateDragPlanRef = useRef<{
        selection: Map<string, DrawingToolExport>;
        primaryId: string;
    } | null>(null);
    const pointerGestureRef = useRef<{
        clientX: number;
        clientY: number;
        button: number;
        pointerType: string;
        ctrlOrMeta: boolean;
        selectedIds: string[];
    } | null>(null);
    const selectionBoxDragRef = useRef<{
        startPoint: { x: number; y: number };
        currentPoint: { x: number; y: number };
        additiveSelection: boolean;
        initialSelection: string[];
        active: boolean;
    } | null>(null);
    const touchInteractionLockedRef = useRef(false);
    const getDrawingIdsWithinSelectionBoxRef = useRef<(box: SelectionBoxBounds) => string[]>(() => []);
    const liveTradeLineMetaRef = useRef<Map<string, LiveTradeLineMeta>>(new Map());
    const liveTradeLineSpecsRef = useRef<Map<string, LiveTradeLineSpec>>(new Map());
    const liveTradeAmendTimersRef = useRef<Map<string, number>>(new Map());
    const liveTradePreviewPricesRef = useRef<Record<string, number>>({});
    const onActiveLivePositionChangeRef = useRef<typeof onActiveLivePositionChange>(onActiveLivePositionChange);
    const onActiveLivePositionCloseRef = useRef<typeof onActiveLivePositionClose>(onActiveLivePositionClose);
    const onActiveLiveOrderChangeRef = useRef<typeof onActiveLiveOrderChange>(onActiveLiveOrderChange);
    const onActiveLiveOrderCancelRef = useRef<typeof onActiveLiveOrderCancel>(onActiveLiveOrderCancel);
    const onActivePriceAlertChangeRef = useRef<typeof onActivePriceAlertChange>(onActivePriceAlertChange);
    const onActivePriceAlertDeleteRef = useRef<typeof onActivePriceAlertDelete>(onActivePriceAlertDelete);
    const onCrosshairQuickAlertCreateRef = useRef<typeof onCrosshairQuickAlertCreate>(onCrosshairQuickAlertCreate);
    const onCrosshairQuickOrderCreateRef = useRef<typeof onCrosshairQuickOrderCreate>(onCrosshairQuickOrderCreate);
    const onTradeHistoryClickRef = useRef<typeof onTradeHistoryClick>(onTradeHistoryClick);
    const tradeHistoryRef = useRef<Trade[] | undefined>(tradeHistory);
    const clickCycleTimestampRef = useRef<number | null>(null);
    const clickCycleIndexRef = useRef<number>(0);
    const tradeHistoryPluginMapRef = useRef<Map<number, RiskRewardPlugin>>(new Map());
    const selectedTradeHistoryIdRef = useRef<number | null | undefined>(selectedTradeHistoryId);
    selectedTradeHistoryIdRef.current = selectedTradeHistoryId;
    const crosshairQuickActionRef = useRef<HTMLDivElement | null>(null);
    const crosshairQuickActionFrameRef = useRef<number | null>(null);
    const pendingCrosshairQuickActionRef = useRef<CrosshairQuickActionState | null>(null);
    const canShowCrosshairQuickActionsRef = useRef<boolean>(Boolean(
        onCrosshairQuickAlertCreate || onCrosshairQuickOrderCreate
    ));
    const liveTradeDragSessionRef = useRef<LiveTradeHtmlDragSession | null>(null);
    const priceFormat = useMemo(
        () => buildSeriesPriceFormat(longShortSymbol ?? trade?.symbol, data),
        [data, longShortSymbol, trade?.symbol]
    );
    const priceFormatRef = useRef(priceFormat);

    const scheduleCrosshairQuickAction = useCallback((nextAction: CrosshairQuickActionState | null) => {
        pendingCrosshairQuickActionRef.current = nextAction;
        if (crosshairQuickActionFrameRef.current != null) {
            return;
        }

        crosshairQuickActionFrameRef.current = window.requestAnimationFrame(() => {
            crosshairQuickActionFrameRef.current = null;
            const pendingAction = pendingCrosshairQuickActionRef.current;

            setCrosshairQuickAction((current) => {
                if (current == null && pendingAction == null) {
                    return current;
                }

                if (
                    current != null &&
                    pendingAction != null &&
                    Math.abs(current.y - pendingAction.y) <= 0.5 &&
                    Math.abs(current.price - pendingAction.price) <= priceFormatRef.current.minMove / 2
                ) {
                    return current;
                }

                return pendingAction;
            });
        });
    }, []);

    const clearCrosshairQuickAction = useCallback(() => {
        pendingCrosshairQuickActionRef.current = null;
        if (crosshairQuickActionFrameRef.current != null) {
            cancelAnimationFrame(crosshairQuickActionFrameRef.current);
            crosshairQuickActionFrameRef.current = null;
        }
        setCrosshairQuickAction(null);
    }, []);
    const clearTradeHistoryPlugins = useCallback((series: ISeriesApi<"Candlestick"> | null = seriesRef.current) => {
        if (!series || tradeHistoryPluginsRef.current.length === 0) {
            tradeHistoryPluginsRef.current = [];
            return;
        }

        for (const plugin of tradeHistoryPluginsRef.current) {
            try {
                series.detachPrimitive(plugin);
            } catch {
                // Ignore teardown errors during rapid chart updates/unmounts.
            }
        }

        tradeHistoryPluginsRef.current = [];
        tradeHistoryPluginMapRef.current.clear();
    }, []);

    useEffect(() => {
        drawingToolRef.current = drawingTool;
        syncLongShortLabelVisibilityRef.current();
    }, [drawingTool]);

    const applyChartInteractionLock = useCallback((touchLocked: boolean) => {
        touchInteractionLockedRef.current = touchLocked;

        const chart = chartRef.current;
        if (!chart) return;

        const isInteractionLocked = drawingToolRef.current != null || touchLocked;
        chart.applyOptions({
            handleScroll: {
                pressedMouseMove: !isInteractionLocked,
                horzTouchDrag: !isInteractionLocked,
                vertTouchDrag: !isInteractionLocked,
            },
            handleScale: {
                mouseWheel: true,
                pinch: !isInteractionLocked,
                axisPressedMouseMove: {
                    time: !isInteractionLocked,
                    price: !isInteractionLocked,
                },
            },
        });
    }, []);

    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    useEffect(() => () => {
        if (crosshairQuickActionFrameRef.current != null) {
            cancelAnimationFrame(crosshairQuickActionFrameRef.current);
            crosshairQuickActionFrameRef.current = null;
        }
    }, []);

    useEffect(() => {
        continuousDrawingRef.current = continuousDrawing;
    }, [continuousDrawing]);

    useEffect(() => {
        drawingLineColorRef.current = drawingLineColor;
        rectangleFillColorRef.current = rectangleFillColor;
        rectangleBorderColorRef.current = rectangleBorderColor;
    }, [drawingLineColor, rectangleFillColor, rectangleBorderColor]);

    useEffect(() => {
        calloutTextRef.current = calloutText;
        calloutFontSizeRef.current = calloutFontSize;
        calloutTextColorRef.current = calloutTextColor;
        calloutLineColorRef.current = calloutLineColor;
        calloutBoxColorRef.current = calloutBoxColor;
    }, [calloutBoxColor, calloutFontSize, calloutLineColor, calloutText, calloutTextColor]);

    useEffect(() => {
        heightRef.current = height;
        if (chartRef.current && containerRef.current) {
            const width = containerRef.current.clientWidth;
            if (width > 0) {
                chartRef.current.applyOptions({ width, height });
            }
        }
    }, [height]);

    useEffect(() => {
        longShortLotsRef.current = longShortLots;
        longShortSymbolRef.current = longShortSymbol;
    }, [longShortLots, longShortSymbol]);

    useEffect(() => {
        onReplayPlacementPreviewChangeRef.current = onReplayPlacementPreviewChange;
        onReplayPlacementSelectRef.current = onReplayPlacementSelect;
    }, [onReplayPlacementPreviewChange, onReplayPlacementSelect]);

    useEffect(() => {
        onTradeHistoryClickRef.current = onTradeHistoryClick;
        tradeHistoryRef.current = tradeHistory;
    }, [onTradeHistoryClick, tradeHistory]);

    useEffect(() => {
        replayPlacementModeRef.current = replayPlacementMode;
    }, [replayPlacementMode]);

    useEffect(() => {
        replayPlacementTimestampRef.current = replayPlacementTimestamp;
    }, [replayPlacementTimestamp]);

    useEffect(() => {
        if (!showCandleCountdown || candleCountdownAnchorTimestamp == null) {
            return;
        }

        setCountdownNow(Date.now());

        const updateCountdown = () => {
            setCountdownNow(Date.now());
        };

        const alignDelay = 1000 - (Date.now() % 1000);
        let intervalId: number | null = null;
        const timeoutId = window.setTimeout(() => {
            updateCountdown();
            intervalId = window.setInterval(updateCountdown, 1000);
        }, alignDelay);

        return () => {
            window.clearTimeout(timeoutId);
            if (intervalId != null) {
                window.clearInterval(intervalId);
            }
        };
    }, [candleCountdownAnchorTimestamp, showCandleCountdown]);

    const computedTimeGuides = useMemo(
        () => buildTimeGuides(data, timeframe, timeGuides),
        [data, timeframe, timeGuides]
    );

    const candleCountdownLabel = useMemo(() => {
        if (!showCandleCountdown || candleCountdownAnchorTimestamp == null || !timeframe) {
            return null;
        }

        const timeframeSeconds = timeframeToSeconds(timeframe);
        if (!Number.isFinite(timeframeSeconds) || timeframeSeconds <= 0) {
            return null;
        }

        const candleEnd = candleCountdownAnchorTimestamp + timeframeSeconds * 1000;
        const remainingMs = candleEnd - countdownNow;
        if (remainingMs <= 0) {
            return "00:00";
        }

        return formatCandleCountdown(remainingMs);
    }, [candleCountdownAnchorTimestamp, countdownNow, showCandleCountdown, timeframe]);

    const candleCountdownPrice = useMemo(() => {
        if (!showCandleCountdown) {
            return null;
        }

        if (liveBidPrice != null && Number.isFinite(liveBidPrice)) {
            return liveBidPrice;
        }

        const lastBar = data[data.length - 1];
        if (lastBar && Number.isFinite(lastBar.close)) {
            return lastBar.close;
        }

        return null;
    }, [data, liveBidPrice, showCandleCountdown]);

    const candleCountdownLabelWidth = useMemo(() => {
        if (candleCountdownPrice == null) {
            return 44;
        }

        const formattedPrice = formatPriceScaleLabel(candleCountdownPrice, priceFormat.precision);
        return Math.max(38, formattedPrice.length * 6.8 + 8);
    }, [candleCountdownPrice, priceFormat.precision]);

    const candleCountdownPriceLabel = useMemo(() => {
        if (candleCountdownPrice == null) {
            return null;
        }

        return formatPriceScaleLabel(candleCountdownPrice, priceFormat.precision);
    }, [candleCountdownPrice, priceFormat.precision]);

    const useCustomLivePriceStack =
        showCandleCountdown &&
        candleCountdownLabel != null &&
        candleCountdownPriceLabel != null;

    const shouldBridgeTouchInteraction = useCallback((options?: { hitToolId?: string | null }) => {
        return (
            drawingToolRef.current != null ||
            replayPlacementModeRef.current ||
            options?.hitToolId != null
        );
    }, []);

    const canShowCrosshairQuickActions = Boolean(
        onCrosshairQuickAlertCreate || onCrosshairQuickOrderCreate
    );
    const crosshairQuickPriceLabel = useMemo(() => {
        if (!crosshairQuickAction) {
            return null;
        }
        return formatPriceScaleLabel(crosshairQuickAction.price, priceFormat.precision);
    }, [crosshairQuickAction, priceFormat.precision]);
    const crosshairBuyOrderType = useMemo(
        () =>
            crosshairQuickAction
                ? getCrosshairQuickOrderType("BUY", crosshairQuickAction.price, liveBidPrice, liveAskPrice)
                : "LIMIT",
        [crosshairQuickAction, liveAskPrice, liveBidPrice]
    );
    const crosshairSellOrderType = useMemo(
        () =>
            crosshairQuickAction
                ? getCrosshairQuickOrderType("SELL", crosshairQuickAction.price, liveBidPrice, liveAskPrice)
                : "LIMIT",
        [crosshairQuickAction, liveAskPrice, liveBidPrice]
    );
    const isCrosshairQuickActionBlocked = useMemo(() => {
        if (!crosshairQuickAction) {
            return false;
        }

        return liveTradeOverlayItems.some((item) => Math.abs(item.y - crosshairQuickAction.y) <= 14);
    }, [crosshairQuickAction, liveTradeOverlayItems]);

    const refreshTimeGuideOverlay = useCallback(() => {
        const chart = chartRef.current;

        if (!chart) {
            setTimeGuideOverlay((current) =>
                current.width === null &&
                current.height === null &&
                current.verticalLines.length === 0
                    ? current
                    : { width: null, height: null, verticalLines: [] }
            );
            setMarkerOverlay({ width: null, height: null, x: null });
            return;
        }

        if (computedTimeGuides.verticalLines.length === 0 && !showMarker) {
            setTimeGuideOverlay((current) =>
                current.width === null &&
                current.height === null &&
                current.verticalLines.length === 0
                    ? current
                    : { width: null, height: null, verticalLines: [] }
            );
            setMarkerOverlay({ width: null, height: null, x: null });
            return;
        }

        const timeScale = chart.timeScale();
        const paneSize = chart.paneSize();
        const nextVerticalLines: Array<{ id: string; kind: "daily" | "session" | "marker"; x: number }> = [];

        for (const line of computedTimeGuides.verticalLines) {
            const x = timeScale.timeToCoordinate((line.timestamp / 1000) as Time);
            if (x == null || !Number.isFinite(x)) continue;
            if (clipTimeGuideOverlayToPane && (x < 0 || x > paneSize.width)) continue;
            nextVerticalLines.push({
                id: line.id,
                kind: line.kind,
                x,
            });
        }

        let markerX: number | null = null;
        if (showMarker && markerTimestamp != null) {
            const x = timeScale.timeToCoordinate((markerTimestamp / 1000) as Time);
            if (x != null && Number.isFinite(x) && (!clipTimeGuideOverlayToPane || (x >= 0 && x <= paneSize.width))) {
                nextVerticalLines.push({
                    id: "marker-user",
                    kind: "marker",
                    x,
                });
                markerX = x;
            }
        }
        setMarkerOverlay({
            width: clipTimeGuideOverlayToPane ? paneSize.width : null,
            height: clipTimeGuideOverlayToPane ? paneSize.height : null,
            x: markerX,
        });

        const nextOverlay = {
            width: clipTimeGuideOverlayToPane ? paneSize.width : null,
            height: clipTimeGuideOverlayToPane ? paneSize.height : null,
            verticalLines: nextVerticalLines,
        };

        setTimeGuideOverlay((current) =>
            sameTimeGuideOverlay(current, nextOverlay) ? current : nextOverlay
        );
    }, [clipTimeGuideOverlayToPane, computedTimeGuides, showMarker, markerTimestamp]);

    const refreshCandleCountdownOverlay = useCallback(() => {
        if (!useCustomLivePriceStack || candleCountdownPrice == null) {
            setCandleCountdownOverlay((current) =>
                current.top === null && current.right === null
                    ? current
                    : { top: null, right: null }
            );
            return;
        }

        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series) {
            setCandleCountdownOverlay((current) =>
                current.top === null && current.right === null
                    ? current
                    : { top: null, right: null }
            );
            return;
        }

        const paneSize = chart.paneSize();
        const y = series.priceToCoordinate(candleCountdownPrice);
        if (
            y == null ||
            !Number.isFinite(y) ||
            y < 0 ||
            y > paneSize.height
        ) {
            setCandleCountdownOverlay((current) =>
                current.top === null && current.right === null
                    ? current
                    : { top: null, right: null }
            );
            return;
        }

        const totalHeight = 24;
        const top = Math.max(0, Math.min(y - 7, Math.max(0, paneSize.height - totalHeight)));
        const nextOverlay = {
            top,
            right: 0,
        };

        setCandleCountdownOverlay((current) =>
            sameCandleCountdownOverlay(current, nextOverlay) ? current : nextOverlay
        );
    }, [candleCountdownPrice, useCustomLivePriceStack]);

    const refreshLiveTradeOverlay = useCallback(() => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        const container = containerRef.current;
        if (!chart || !series || !container) {
            setLiveTradeOverlayItems((current) => (current.length === 0 ? current : []));
            return;
        }

        const paneSize = chart.paneSize();
        const padRight = Math.max(0, container.clientWidth - paneSize.width);
        setLiveTradeOverlayPadRight((prev) => (Math.abs(prev - padRight) < 1 ? prev : padRight));

        const nextItems: LiveTradeOverlayItem[] = [];

        const addItem = (rawPrice: number, dragToolId: string | undefined, item: Omit<LiveTradeOverlayItem, "y">) => {
            const displayPrice = dragToolId ? (liveTradePreviewPrices[dragToolId] ?? rawPrice) : rawPrice;
            const y = series.priceToCoordinate(displayPrice);
            if (y == null || !Number.isFinite(y) || y < -20 || y > paneSize.height + 20) return;
            nextItems.push({ ...item, y } as LiveTradeOverlayItem);
        };

        const computePnl = (entryPrice: number, targetPrice: number, lots: number, direction: string, symbol: string) => {
            const pnl = estimateGrossProfit(entryPrice, targetPrice, lots, direction, symbol);
            if (!Number.isFinite(pnl) || Math.abs(pnl) >= 1_000_000) return { label: undefined, positive: undefined };
            return { label: `${formatLiveMoneyLabel(pnl)} USD`, positive: pnl >= 0 };
        };

        const computePips = (entryPrice: number, targetPrice: number, direction: string, symbol: string) => {
            const priceDiff = direction === "Buy" ? targetPrice - entryPrice : entryPrice - targetPrice;
            const pips = priceDiffToPips(priceDiff, symbol);
            if (!Number.isFinite(pips) || Math.abs(pips) >= 1_000_000) {
                return { label: undefined, positive: undefined };
            }
            return { label: formatLivePipsLabel(pips), positive: pips >= 0 };
        };

        const fallbackClosePrice = data[data.length - 1]?.close;

        for (const position of activeLivePositions) {
            if (!Number.isFinite(position.entryPrice)) continue;
            const entryPrice = position.entryPrice as number;
            const direction = position.direction;
            const symbol = longShortSymbolRef.current ?? "";
            const lots = position.lots;
            const lotsLabel = formatLiveTradeLotsLabel(lots);
            const slToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}position-sl:${position.positionId}`;
            const tpToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}position-tp:${position.positionId}`;
            const currentMarketPrice =
                direction === "Buy"
                    ? (Number.isFinite(liveBidPrice) ? liveBidPrice : Number.isFinite(liveAskPrice) ? liveAskPrice : fallbackClosePrice)
                    : (Number.isFinite(liveAskPrice) ? liveAskPrice : Number.isFinite(liveBidPrice) ? liveBidPrice : fallbackClosePrice);
            const entryPnl =
                Number.isFinite(currentMarketPrice)
                    ? estimateGrossProfit(entryPrice, currentMarketPrice as number, lots, direction, symbol)
                    : NaN;
            const entryPips =
                Number.isFinite(currentMarketPrice)
                    ? priceDiffToPips(
                        direction === "Buy"
                            ? (currentMarketPrice as number) - entryPrice
                            : entryPrice - (currentMarketPrice as number),
                        symbol
                    )
                    : NaN;

            addItem(entryPrice, undefined, {
                id: `position-entry:${position.positionId}`,
                lineType: "position-entry",
                color: "rgba(59, 130, 246, 0.95)",
                lotsLabel,
                label: direction,
                pipsLabel: Number.isFinite(entryPips) ? formatLivePipsLabel(entryPips) : undefined,
                pipsPositive: Number.isFinite(entryPips) ? entryPips >= 0 : undefined,
                currentPnlLabel: Number.isFinite(entryPnl) ? formatLiveMoneyLabel(entryPnl) : undefined,
                currentPnlPositive: Number.isFinite(entryPnl) ? entryPnl >= 0 : undefined,
                draggable: false,
                positionId: position.positionId,
                showTpToggle: !Number.isFinite(position.takeProfit),
                showSlToggle: !Number.isFinite(position.stopLoss),
                tpDragToolId: tpToolId,
                slDragToolId: slToolId,
                hasTp: Number.isFinite(position.takeProfit),
                hasSl: Number.isFinite(position.stopLoss),
            });

            if (Number.isFinite(position.stopLoss)) {
                const slPrice = liveTradePreviewPrices[slToolId] ?? (position.stopLoss as number);
                const pnl = computePnl(entryPrice, slPrice, lots, direction, symbol);
                const pips = computePips(entryPrice, slPrice, direction, symbol);
                addItem(position.stopLoss as number, slToolId, {
                    id: `position-sl:${position.positionId}`,
                    lineType: "position-sl",
                    color: "rgba(239, 68, 68, 0.95)",
                    lotsLabel,
                    label: "SL",
                    pipsLabel: pips.label,
                    pipsPositive: pips.positive,
                    pnlLabel: pnl.label,
                    pnlPositive: pnl.positive,
                    draggable: true,
                    dragToolId: slToolId,
                    positionId: position.positionId,
                });
            }

            if (Number.isFinite(position.takeProfit)) {
                const tpPrice = liveTradePreviewPrices[tpToolId] ?? (position.takeProfit as number);
                const pnl = computePnl(entryPrice, tpPrice, lots, direction, symbol);
                const pips = computePips(entryPrice, tpPrice, direction, symbol);
                addItem(position.takeProfit as number, tpToolId, {
                    id: `position-tp:${position.positionId}`,
                    lineType: "position-tp",
                    color: "rgba(16, 185, 129, 0.95)",
                    lotsLabel,
                    label: "TP",
                    pipsLabel: pips.label,
                    pipsPositive: pips.positive,
                    pnlLabel: pnl.label,
                    pnlPositive: pnl.positive,
                    draggable: true,
                    dragToolId: tpToolId,
                    positionId: position.positionId,
                });
            }
        }

        for (const order of activeLiveOrders) {
            const isLimit = String(order.orderType).toUpperCase().includes("LIMIT");
            const primaryPrice = isLimit ? order.limitPrice : order.stopPrice;
            if (!Number.isFinite(primaryPrice)) continue;
            const entryPrice = primaryPrice as number;
            const direction = order.direction;
            const symbol = longShortSymbolRef.current ?? "";
            const lots = order.lots;
            const lotsLabel = formatLiveTradeLotsLabel(lots);
            const entryToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-entry:${order.orderId}`;
            const slToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-sl:${order.orderId}`;
            const tpToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-tp:${order.orderId}`;
            const orderLabel = formatLiveOrderLabel(direction, order.orderType);
            const baseColor = isLimit ? "rgba(59, 130, 246, 0.95)" : "rgba(168, 85, 247, 0.95)";

            addItem(entryPrice, entryToolId, {
                id: `order-entry:${order.orderId}`,
                lineType: "order-entry",
                color: baseColor,
                lotsLabel,
                label: orderLabel,
                draggable: true,
                dragToolId: entryToolId,
                orderId: order.orderId,
                showTpToggle: !Number.isFinite(order.takeProfit),
                showSlToggle: !Number.isFinite(order.stopLoss),
                tpDragToolId: tpToolId,
                slDragToolId: slToolId,
                hasTp: Number.isFinite(order.takeProfit),
                hasSl: Number.isFinite(order.stopLoss),
            });

            if (Number.isFinite(order.stopLoss)) {
                const slPrice = liveTradePreviewPrices[slToolId] ?? (order.stopLoss as number);
                const pnl = computePnl(entryPrice, slPrice, lots, direction, symbol);
                const pips = computePips(entryPrice, slPrice, direction, symbol);
                addItem(order.stopLoss as number, slToolId, {
                    id: `order-sl:${order.orderId}`,
                    lineType: "order-sl",
                    color: "rgba(239, 68, 68, 0.95)",
                    lotsLabel,
                    label: "SL",
                    pipsLabel: pips.label,
                    pipsPositive: pips.positive,
                    pnlLabel: pnl.label,
                    pnlPositive: pnl.positive,
                    draggable: true,
                    dragToolId: slToolId,
                    orderId: order.orderId,
                });
            }

            if (Number.isFinite(order.takeProfit)) {
                const tpPrice = liveTradePreviewPrices[tpToolId] ?? (order.takeProfit as number);
                const pnl = computePnl(entryPrice, tpPrice, lots, direction, symbol);
                const pips = computePips(entryPrice, tpPrice, direction, symbol);
                addItem(order.takeProfit as number, tpToolId, {
                    id: `order-tp:${order.orderId}`,
                    lineType: "order-tp",
                    color: "rgba(16, 185, 129, 0.95)",
                    lotsLabel,
                    label: "TP",
                    pipsLabel: pips.label,
                    pipsPositive: pips.positive,
                    pnlLabel: pnl.label,
                    pnlPositive: pnl.positive,
                    draggable: true,
                    dragToolId: tpToolId,
                    orderId: order.orderId,
                });
            }
        }

        if (showPriceAlerts) {
            for (const alert of activePriceAlerts) {
                if (!Number.isFinite(alert.targetPrice)) continue;
                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}alert-target:${alert.id}`;
                const alertColor =
                    alert.condition === "below"
                        ? "rgba(245, 158, 11, 0.95)"
                        : "rgba(14, 165, 233, 0.95)";
                addItem(alert.targetPrice, toolId, {
                    id: `alert-target:${alert.id}`,
                    lineType: "alert-target",
                    color: alertColor,
                    lotsLabel: alert.priceSide.toUpperCase(),
                    label: alert.note?.trim() || formatAlertCondition(alert.condition),
                    draggable: true,
                    dragToolId: toolId,
                    alertId: alert.id,
                });
            }
        }

        nextItems.sort((left, right) => left.y - right.y);
        setLiveTradeOverlayItems((current) =>
            sameLiveTradeOverlayItems(current, nextItems) ? current : nextItems
        );
    }, [activeLiveOrders, activeLivePositions, activePriceAlerts, data, liveAskPrice, liveBidPrice, liveTradePreviewPrices, showPriceAlerts]);

    const resolveLiveTradePreviewDescriptor = useCallback((
        toolId: string,
        fallbackPrice?: number
    ): { meta: LiveTradeLineMeta; spec: LiveTradeLineSpec } | null => {
        const existingMeta = liveTradeLineMetaRef.current.get(toolId);
        const existingSpec = liveTradeLineSpecsRef.current.get(toolId);
        if (existingMeta && existingSpec) {
            return {
                meta: existingMeta,
                spec: {
                    ...existingSpec,
                    price: typeof fallbackPrice === "number" ? fallbackPrice : existingSpec.price,
                },
            };
        }

        const parsed = toolId.match(/^live-trade:(position|order|alert)-(entry|sl|tp|target):(.+)$/);
        if (!parsed) return null;

        const [, scope, segment, id] = parsed;
        if (scope === "position") {
            const position = activeLivePositions.find((candidate) => candidate.positionId === id);
            if (!position || !Number.isFinite(position.entryPrice)) return null;

            if (segment === "sl") {
                const price =
                    typeof fallbackPrice === "number"
                        ? fallbackPrice
                        : position.stopLoss ?? position.entryPrice ?? NaN;
                if (!Number.isFinite(price)) return null;
                return {
                    meta: { kind: "position-stopLoss", positionId: id },
                    spec: {
                        id: toolId,
                        price,
                        title: "SL",
                        color: "rgba(245, 158, 11, 0.95)",
                        lineStyle: LineStyle.Dotted,
                        editable: true,
                        toolMeta: { kind: "position-stopLoss", positionId: id },
                    },
                };
            }

            if (segment === "tp") {
                const price =
                    typeof fallbackPrice === "number"
                        ? fallbackPrice
                        : position.takeProfit ?? position.entryPrice ?? NaN;
                if (!Number.isFinite(price)) return null;
                return {
                    meta: { kind: "position-takeProfit", positionId: id },
                    spec: {
                        id: toolId,
                        price,
                        title: "TP",
                        color: "rgba(16, 185, 129, 0.95)",
                        lineStyle: LineStyle.Dotted,
                        editable: true,
                        toolMeta: { kind: "position-takeProfit", positionId: id },
                    },
                };
            }

            return null;
        }

        if (scope === "alert") {
            const alert = activePriceAlerts.find((candidate) => candidate.id === id);
            if (!alert || segment !== "target") return null;
            const price = typeof fallbackPrice === "number" ? fallbackPrice : alert.targetPrice;
            if (!Number.isFinite(price)) return null;
            const color =
                alert.condition === "below"
                    ? "rgba(245, 158, 11, 0.95)"
                    : "rgba(14, 165, 233, 0.95)";
            return {
                meta: { kind: "alert-target", alertId: id, priceSide: alert.priceSide },
                spec: {
                    id: toolId,
                    price,
                    title: alert.note?.trim() || formatAlertCondition(alert.condition),
                    color,
                    lineStyle: LineStyle.Dashed,
                    editable: true,
                    toolMeta: { kind: "alert-target", alertId: id, priceSide: alert.priceSide },
                },
            };
        }

        const order = activeLiveOrders.find((candidate) => candidate.orderId === id);
        if (!order) return null;

        if (segment === "entry") {
            const isLimit = String(order.orderType).toUpperCase().includes("LIMIT");
            const basePrice = isLimit ? order.limitPrice : order.stopPrice;
            if (!Number.isFinite(basePrice) && !Number.isFinite(fallbackPrice)) return null;
            const price = typeof fallbackPrice === "number" ? fallbackPrice : basePrice ?? NaN;
            if (!Number.isFinite(price)) return null;
            return {
                meta: { kind: "order-entry", orderId: id, orderType: order.orderType },
                spec: {
                    id: toolId,
                    price,
                    title: formatLiveTradeTitle(order.lots, formatLiveOrderLabel(order.direction, order.orderType)),
                    color: isLimit ? "rgba(59, 130, 246, 0.95)" : "rgba(168, 85, 247, 0.95)",
                    lineStyle: LineStyle.Solid,
                    editable: true,
                    toolMeta: { kind: "order-entry", orderId: id, orderType: order.orderType },
                },
            };
        }

        if (segment === "sl") {
            const anchorPrice = order.stopLoss ?? order.limitPrice ?? order.stopPrice;
            if (!Number.isFinite(anchorPrice) && !Number.isFinite(fallbackPrice)) return null;
            const price = typeof fallbackPrice === "number" ? fallbackPrice : anchorPrice ?? NaN;
            if (!Number.isFinite(price)) return null;
            return {
                meta: { kind: "order-stopLoss", orderId: id, orderType: order.orderType },
                spec: {
                    id: toolId,
                    price,
                    title: "SL",
                    color: "rgba(245, 158, 11, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: { kind: "order-stopLoss", orderId: id, orderType: order.orderType },
                },
            };
        }

        if (segment === "tp") {
            const anchorPrice = order.takeProfit ?? order.limitPrice ?? order.stopPrice;
            if (!Number.isFinite(anchorPrice) && !Number.isFinite(fallbackPrice)) return null;
            const price = typeof fallbackPrice === "number" ? fallbackPrice : anchorPrice ?? NaN;
            if (!Number.isFinite(price)) return null;
            return {
                meta: { kind: "order-takeProfit", orderId: id, orderType: order.orderType },
                spec: {
                    id: toolId,
                    price,
                    title: "TP",
                    color: "rgba(16, 185, 129, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: { kind: "order-takeProfit", orderId: id, orderType: order.orderType },
                },
            };
        }

        return null;
    }, [activeLiveOrders, activeLivePositions, activePriceAlerts]);

    const applyLiveTradePreviewPrice = useCallback((toolId: string, nextPrice: number) => {
        if (!Number.isFinite(nextPrice)) return;

        const descriptor = resolveLiveTradePreviewDescriptor(toolId, nextPrice);
        if (!descriptor) return;

        setLiveTradePreviewPrices((current) => {
            if (current[toolId] != null && Math.abs(current[toolId] - nextPrice) <= 0.0000001) {
                return current;
            }
            const next = {
                ...current,
                [toolId]: nextPrice,
            };
            liveTradePreviewPricesRef.current = next;
            return next;
        });

        liveTradeLineMetaRef.current.set(toolId, descriptor.meta);
        liveTradeLineSpecsRef.current.set(toolId, descriptor.spec);

        const existingPriceLine = liveTradePriceLinesRef.current.get(toolId);
        if (existingPriceLine) {
            existingPriceLine.applyOptions?.({ price: nextPrice });
        } else if (seriesRef.current) {
            const nextPriceLine = seriesRef.current.createPriceLine({
                price: nextPrice,
                color: descriptor.spec.color,
                lineWidth: 1,
                lineStyle: descriptor.spec.lineStyle,
                axisLabelVisible: true,
                title: "",
                lineVisible: true,
            });
            liveTradePriceLinesRef.current.set(toolId, nextPriceLine);
        }
        scheduleTimeGuideOverlayRefreshRef.current();
    }, [resolveLiveTradePreviewDescriptor]);

    const scheduleTimeGuideOverlayRefresh = useCallback(() => {
        if (overlayFrameRef.current != null) {
            cancelAnimationFrame(overlayFrameRef.current);
        }
        overlayFrameRef.current = requestAnimationFrame(() => {
            overlayFrameRef.current = null;
            refreshTimeGuideOverlay();
            refreshCandleCountdownOverlay();
            refreshLiveTradeOverlay();
            syncLongShortLabelVisibilityRef.current();
        });
    }, [refreshCandleCountdownOverlay, refreshLiveTradeOverlay, refreshTimeGuideOverlay]);

    useEffect(() => {
        scheduleTimeGuideOverlayRefreshRef.current = scheduleTimeGuideOverlayRefresh;
    }, [scheduleTimeGuideOverlayRefresh]);

    const refreshReplayPlacementOverlay = useCallback(() => {
        if (!replayPlacementMode || replayPlacementTimestamp == null) {
            setReplayPlacementOverlay((current) =>
                current.width === null && current.height === null && current.x === null
                    ? current
                    : { width: null, height: null, x: null }
            );
            return;
        }

        const chart = chartRef.current;
        if (!chart) {
            setReplayPlacementOverlay((current) =>
                current.width === null && current.height === null && current.x === null
                    ? current
                    : { width: null, height: null, x: null }
            );
            return;
        }

        const paneSize = chart.paneSize();
        const x = chart.timeScale().timeToCoordinate(drawingTimestampToChartTime(replayPlacementTimestamp));
        const nextOverlay = {
            width: clipTimeGuideOverlayToPane ? paneSize.width : null,
            height: clipTimeGuideOverlayToPane ? paneSize.height : null,
            x: x != null && Number.isFinite(x) ? x : null,
        };

        setReplayPlacementOverlay((current) =>
            sameReplayPlacementOverlay(current, nextOverlay) ? current : nextOverlay
        );
    }, [clipTimeGuideOverlayToPane, replayPlacementMode, replayPlacementTimestamp]);

    const scheduleReplayPlacementOverlayRefresh = useCallback(() => {
        if (overlayFrameRef.current != null) {
            cancelAnimationFrame(overlayFrameRef.current);
        }
        overlayFrameRef.current = requestAnimationFrame(() => {
            overlayFrameRef.current = null;
            refreshTimeGuideOverlay();
            refreshReplayPlacementOverlay();
            refreshCandleCountdownOverlay();
            refreshLiveTradeOverlay();
            syncLongShortLabelVisibilityRef.current();
        });
    }, [refreshCandleCountdownOverlay, refreshLiveTradeOverlay, refreshReplayPlacementOverlay, refreshTimeGuideOverlay]);

    useEffect(() => {
        scheduleReplayPlacementOverlayRefreshRef.current = scheduleReplayPlacementOverlayRefresh;
        scheduleTimeGuideOverlayRefreshRef.current = scheduleReplayPlacementOverlayRefresh;
    }, [scheduleReplayPlacementOverlayRefresh]);

    useEffect(() => {
        if (!isChartReady) {
            setLiveTradeOverlayItems([]);
            return;
        }
        scheduleTimeGuideOverlayRefresh();
    }, [
        activeLiveOrders,
        activeLivePositions,
        isChartReady,
        liveTradePreviewPrices,
        scheduleTimeGuideOverlayRefresh,
    ]);

    useEffect(() => {
        if (!isChartReady) return;
        scheduleTimeGuideOverlayRefreshRef.current();
    }, [showMarker, markerTimestamp, isChartReady]);

    useEffect(() => {
        if (!liveTradeDragSession) return;

        const handlePointerMove = (event: PointerEvent) => {
            const container = containerRef.current;
            const series = seriesRef.current;
            if (!container || !series) return;

            const rect = container.getBoundingClientRect();
            const y = Math.max(0, Math.min(event.clientY - rect.top, rect.height));
            const mappedPrice = series.coordinateToPrice(y);
            const nextPrice =
                typeof mappedPrice === "number" ? mappedPrice : Number(mappedPrice);
            if (!Number.isFinite(nextPrice)) return;

            applyLiveTradePreviewPrice(liveTradeDragSession.toolId, nextPrice);
        };

        const finishDrag = () => {
            const { toolId } = liveTradeDragSession;
            const previewPrice =
                liveTradePreviewPricesRef.current[toolId] ??
                liveTradeLineSpecsRef.current.get(toolId)?.price;
            setLiveTradeDragSession(null);

            const clearPreview = () => {
                setLiveTradePreviewPrices((current) => {
                    if (!(toolId in current)) return current;
                    const next = { ...current };
                    delete next[toolId];
                    liveTradePreviewPricesRef.current = next;
                    return next;
                });
            };

            if (!Number.isFinite(previewPrice)) {
                clearPreview();
                return;
            }

            const resolvedDescriptor = resolveLiveTradePreviewDescriptor(toolId, previewPrice);
            const liveMeta = liveTradeLineMetaRef.current.get(toolId) ?? resolvedDescriptor?.meta;
            if (!liveMeta) {
                clearPreview();
                return;
            }

            void (async () => {
                try {
                    if (liveMeta.kind === "position-stopLoss") {
                        const position = activeLivePositionsRef.current.find(p => p.positionId === liveMeta.positionId);
                        await onActiveLivePositionChangeRef.current?.(
                            liveMeta.positionId,
                            previewPrice,
                            position?.takeProfit ?? undefined
                        );
                        return;
                    }

                    if (liveMeta.kind === "position-takeProfit") {
                        const position = activeLivePositionsRef.current.find(p => p.positionId === liveMeta.positionId);
                        await onActiveLivePositionChangeRef.current?.(
                            liveMeta.positionId,
                            position?.stopLoss ?? undefined,
                            previewPrice
                        );
                        return;
                    }

                    if (liveMeta.kind === "order-entry") {
                        await onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                            ...(String(liveMeta.orderType).toUpperCase().includes("LIMIT")
                                ? { limitPrice: previewPrice }
                                : { stopPrice: previewPrice }),
                        });
                        return;
                    }

                    if (liveMeta.kind === "order-stopLoss") {
                        const order = activeLiveOrdersRef.current.find(o => o.orderId === liveMeta.orderId);
                        await onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                            takeProfit: order?.takeProfit ?? undefined,
                            stopLoss: previewPrice,
                        });
                        return;
                    }

                    if (liveMeta.kind === "order-takeProfit") {
                        const order = activeLiveOrdersRef.current.find(o => o.orderId === liveMeta.orderId);
                        await onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                            stopLoss: order?.stopLoss ?? undefined,
                            takeProfit: previewPrice,
                        });
                        return;
                    }

                    if (liveMeta.kind === "alert-target") {
                        await onActivePriceAlertChangeRef.current?.(
                            liveMeta.alertId,
                            previewPrice,
                            liveMeta.priceSide
                        );
                    }
                } finally {
                    clearPreview();
                }
            })();
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", finishDrag, { once: true });
        window.addEventListener("pointercancel", finishDrag, { once: true });

        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishDrag);
            window.removeEventListener("pointercancel", finishDrag);
        };
    }, [applyLiveTradePreviewPrice, liveTradeDragSession, resolveLiveTradePreviewDescriptor]);

    const formatMoney = (value: number) => {
        const sign = value >= 0 ? "+" : "-";
        return `${sign}$${Math.abs(value).toFixed(2)}`;
    };

    const formatPips = (value: number) => {
        const rounded = Math.round(value * 10) / 10;
        const sign = rounded >= 0 ? "+" : "";
        return `${sign}${rounded}p`;
    };

    const readLongShortLabelVisibility = useCallback((toolId: string) => {
        const raw = lineToolsRef.current?.getLineToolByID?.(toolId);
        if (!raw) return false;

        try {
            const parsed = JSON.parse(raw) as Array<{ options?: Record<string, unknown> }>;
            return areLongShortLabelsVisible(parsed[0]?.options);
        } catch {
            return false;
        }
    }, []);

    const updateLongShortText = useCallback((tool: {
        id: string;
        points: Array<{ price: number }>;
        lots?: number;
        symbol?: string;
    }) => {
        const lineTools = lineToolsRef.current;
        if (!lineTools) return;
        const symbol = tool.symbol ?? longShortSymbolRef.current ?? "";
        const lots = tool.lots ?? longShortLotsRef.current;
        if (!symbol || !Number.isFinite(lots) || lots <= 0) return;
        const entry = tool.points?.[0]?.price;
        const stop = tool.points?.[1]?.price;
        const target = tool.points?.[2]?.price;
        if (!Number.isFinite(entry) || !Number.isFinite(stop) || !Number.isFinite(target)) return;

        const isBuy = stop < entry;
        const direction = isBuy ? "Buy" : "Sell";
        const riskDiff = isBuy ? stop - entry : entry - stop;
        const rewardDiff = isBuy ? target - entry : entry - target;

        const riskDollar = estimateGrossProfit(entry, stop, lots, direction, symbol);
        const rewardDollar = estimateGrossProfit(entry, target, lots, direction, symbol);
        const riskPips = priceDiffToPips(riskDiff, symbol);
        const rewardPips = priceDiffToPips(rewardDiff, symbol);

        const riskText = `Risk ${formatMoney(riskDollar)} · ${formatPips(riskPips)}`;
        const rewardText = `Reward ${formatMoney(rewardDollar)} · ${formatPips(rewardPips)}`;

        const labelsVisible = readLongShortLabelVisibility(tool.id);

        const baseTextStyle = {
            alignment: "left",
            forceTextAlign: true,
            padding: 2,
            font: {
                color: "rgba(255,255,255,0.92)",
                size: 11,
                bold: false,
                family: "Inter, sans-serif",
            },
            box: {
                alignment: {
                    vertical: isBuy ? "bottom" : "top",
                    horizontal: "left",
                },
                angle: 0,
                scale: 1,
                offset: { x: 0, y: 0 },
                padding: { x: 5, y: 3 },
                maxHeight: 0,
                shadow: { blur: 6, color: "rgba(0,0,0,0.4)", offset: { x: 0, y: 2 } },
                border: { color: "rgba(148,163,184,0.2)", width: 1, radius: 5, highlight: false, style: LineStyle.Solid },
                background: { color: "rgba(2,6,23,0.6)", inflation: { x: 0, y: 0 } },
            },
        } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]["options"]["entryStopLossText"];

        const rewardBox = {
            ...baseTextStyle,
            box: {
                ...(baseTextStyle.box as NonNullable<typeof baseTextStyle.box>),
                alignment: {
                    vertical: isBuy ? "top" : "bottom",
                    horizontal: "left",
                },
            },
        };

        lineTools!.applyLineToolOptions({
            id: tool.id,
            toolType: "LongShortPosition",
            options: {
                ...withLongShortLabelsVisible(undefined, labelsVisible),
                showAutoText: labelsVisible,
                entryStopLossText: { ...baseTextStyle, value: riskText },
                entryPtText: { ...rewardBox, value: rewardText },
            },
        } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
    }, [readLongShortLabelVisibility]);

    useEffect(() => {
        onDrawingSelectionChangeRef.current = onDrawingSelectionChange;
    }, [onDrawingSelectionChange]);

    useEffect(() => {
        if (!isChartReady) return;
        scheduleTimeGuideOverlayRefreshRef.current();
    }, [candleCountdownLabel, candleCountdownPrice, data.length, isChartReady]);

    useEffect(() => {
        if (!isChartReady || !showCandleCountdown) return;

        let frameId = 0;

        const syncOverlay = () => {
            refreshCandleCountdownOverlay();
            frameId = window.requestAnimationFrame(syncOverlay);
        };

        frameId = window.requestAnimationFrame(syncOverlay);

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [isChartReady, refreshCandleCountdownOverlay, showCandleCountdown]);

    useEffect(() => {
        onDrawingToolCompleteRef.current = onDrawingToolComplete;
    }, [onDrawingToolComplete]);

    useEffect(() => {
        drawingsHiddenRef.current = drawingsHidden;
    }, [drawingsHidden]);

    useEffect(() => {
        onDrawingToolCancelRef.current = onDrawingToolCancel;
    }, [onDrawingToolCancel]);

    useEffect(() => {
        onRectangleSelectionChangeRef.current = onRectangleSelectionChange;
    }, [onRectangleSelectionChange]);

    useEffect(() => {
        onCalloutEditRequestRef.current = onCalloutEditRequest;
    }, [onCalloutEditRequest]);

    useEffect(() => {
        onActiveLivePositionChangeRef.current = onActiveLivePositionChange;
    }, [onActiveLivePositionChange]);

    useEffect(() => {
        onActiveLivePositionCloseRef.current = onActiveLivePositionClose;
    }, [onActiveLivePositionClose]);

    useEffect(() => {
        onActiveLiveOrderChangeRef.current = onActiveLiveOrderChange;
    }, [onActiveLiveOrderChange]);

    useEffect(() => {
        onActiveLiveOrderCancelRef.current = onActiveLiveOrderCancel;
    }, [onActiveLiveOrderCancel]);

    useEffect(() => {
        onActivePriceAlertChangeRef.current = onActivePriceAlertChange;
    }, [onActivePriceAlertChange]);

    useEffect(() => {
        onActivePriceAlertDeleteRef.current = onActivePriceAlertDelete;
    }, [onActivePriceAlertDelete]);

    useEffect(() => {
        onCrosshairQuickAlertCreateRef.current = onCrosshairQuickAlertCreate;
    }, [onCrosshairQuickAlertCreate]);

    useEffect(() => {
        onCrosshairQuickOrderCreateRef.current = onCrosshairQuickOrderCreate;
    }, [onCrosshairQuickOrderCreate]);

    useEffect(() => {
        canShowCrosshairQuickActionsRef.current = canShowCrosshairQuickActions;
    }, [canShowCrosshairQuickActions]);

    useEffect(() => {
        liveTradeDragSessionRef.current = liveTradeDragSession;
    }, [liveTradeDragSession]);

    useEffect(() => {
        priceFormatRef.current = priceFormat;
    }, [priceFormat]);

    useEffect(() => {
        activeLivePositionsRef.current = activeLivePositions;
    }, [activeLivePositions]);

    useEffect(() => {
        activeLiveOrdersRef.current = activeLiveOrders;
    }, [activeLiveOrders]);

    useEffect(() => {
        activePriceAlertsRef.current = activePriceAlerts;
    }, [activePriceAlerts]);

    useEffect(() => {
        liveTradePreviewPricesRef.current = liveTradePreviewPrices;
    }, [liveTradePreviewPrices]);

    useEffect(() => {
        if (!isCrosshairQuickMenuOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (target && crosshairQuickActionRef.current?.contains(target)) {
                return;
            }
            setIsCrosshairQuickMenuOpen(false);
        };

        window.addEventListener("pointerdown", handlePointerDown);
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [isCrosshairQuickMenuOpen]);

    useEffect(() => {
        if (crosshairQuickAction != null) {
            return;
        }
        setIsCrosshairQuickMenuOpen(false);
    }, [crosshairQuickAction]);

    const getLineToolsInternal = useCallback(() => lineToolsRef.current as LineToolsInternalApi | null, []);

    const removeLineToolsByIdSafely = useCallback((ids: string[]) => {
        if (ids.length === 0) return;

        const lineTools = getLineToolsInternal();
        if (!lineTools) return;

        const toolsMap = lineTools._tools;
        const removableIds =
            toolsMap && toolsMap.size > 0
                ? ids.filter((id) => toolsMap.has(id))
                : ids;
        if (removableIds.length === 0) return;

        try {
            lineTools.removeLineToolsById(removableIds);
        } catch {
            // The line tool plugin can race with chart detach/close; treat stale removals as no-op.
        }
    }, [getLineToolsInternal]);

    const buildDrawingToolOptions = useCallback(
        (toolType: DrawingToolType | null): Parameters<LineToolsApi["addLineTool"]>[2] | undefined => {
            if (!toolType) return undefined;

            const axisLabelOptions = {
                showPriceAxisLabels: false,
                showTimeAxisLabels: false,
            } as Parameters<LineToolsApi["addLineTool"]>[2];

            if (toolType === "LongShortPosition") {
                const labelsVisible = drawingToolRef.current === "LongShortPosition";
                return {
                    ...withLongShortLabelsVisible(undefined, labelsVisible),
                    showAutoText: labelsVisible,
                    showPriceAxisLabels: false,
                    showTimeAxisLabels: false,
                    initialWidthSeconds: defaultLongShortWidthSeconds(timeframe),
                } as unknown as Parameters<LineToolsApi["addLineTool"]>[2];
            }

            if (toolType === "Rectangle") {
                return {
                    ...axisLabelOptions,
                    rectangle: {
                        ...(rectangleFillColorRef.current
                            ? { background: { color: rectangleFillColorRef.current } }
                            : {}),
                        ...(rectangleBorderColorRef.current
                            ? { border: { color: rectangleBorderColorRef.current } }
                            : {}),
                    },
                } as Parameters<LineToolsApi["addLineTool"]>[2];
            }

            if (toolType === "Callout") {
                return {
                    ...axisLabelOptions,
                    line: { color: calloutLineColorRef.current || "#00ff66" },
                    text: buildCalloutTextOptions({
                        text: calloutTextRef.current || "Text",
                        fontSize: calloutFontSizeRef.current || 18,
                        textColor: calloutTextColorRef.current || "#00ff66",
                        boxColor: calloutBoxColorRef.current || "rgba(0,0,0,0.88)",
                        lineColor: calloutLineColorRef.current || "#00ff66",
                    }),
                } as Parameters<LineToolsApi["addLineTool"]>[2];
            }

            if (toolType === "Brush") {
                return {
                    ...axisLabelOptions,
                    ...(drawingLineColorRef.current
                        ? { line: { color: drawingLineColorRef.current } }
                        : {}),
                } as Parameters<LineToolsApi["addLineTool"]>[2];
            }

            if (
                toolType === "Gan" ||
                toolType === "TrendLine" ||
                toolType === "Path" ||
                toolType === "HorizontalRay"
            ) {
                return drawingLineColorRef.current
                    ? ({
                          ...axisLabelOptions,
                          line: { color: drawingLineColorRef.current },
                      } as Parameters<LineToolsApi["addLineTool"]>[2])
                    : axisLabelOptions;
            }

            return axisLabelOptions;
        },
        [timeframe]
    );

    const cancelActiveDrawing = useCallback(() => {
        const lineTools = getLineToolsInternal();
        const interactionManager = lineTools?._interactionManager;
        const currentToolId = interactionManager?._currentToolCreating?.id();

        if (currentToolId) {
            removeLineToolsByIdSafely([currentToolId]);
        }

        interactionManager?.setCurrentToolCreating?.(null);
        interactionManager?.deselectAllTools?.();
        lineTools?.requestUpdate?.();
    }, [getLineToolsInternal, removeLineToolsByIdSafely]);

    const parseDrawingToolExports = useCallback((raw: string | null | undefined): DrawingToolExport[] => {
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw) as Array<{
                id?: string;
                toolType?: string;
                points?: Array<{ timestamp?: number; price?: number }>;
                options?: Record<string, unknown>;
            }>;
            return parsed
                .filter((tool): tool is Required<Pick<DrawingToolExport, "id" | "toolType" | "points">> & { options?: Record<string, unknown> } =>
                    Boolean(tool.id) &&
                    typeof tool.toolType === "string" &&
                    isDrawingToolType(tool.toolType) &&
                    Array.isArray(tool.points)
                )
                .map((tool) => ({
                    id: tool.id,
                    toolType: tool.toolType,
                    points: tool.points
                        .filter((point): point is DrawingPoint =>
                            point != null &&
                            Number.isFinite(point.timestamp) &&
                            Number.isFinite(point.price)
                        )
                        .map((point) => ({
                            timestamp: point.timestamp,
                            price: point.price,
                        })),
                    options: tool.options,
                }));
        } catch {
            return [];
        }
    }, []);

    const exportCurrentDrawings = useCallback((): DrawingToolExport[] => {
        if (!lineToolsRef.current) return [];

        const toolsMap = getLineToolsInternal()?._tools;
        if (toolsMap && toolsMap.size > 0) {
            const hasUserDrawings = Array.from(toolsMap.values()).some((tool) => {
                const toolId = tool.id();
                if (!toolId || isLiveTradeToolId(toolId)) {
                    return false;
                }
                try {
                    const exportData = tool.getExportData();
                    return (
                        exportData != null &&
                        !isLiveTradeToolId(exportData.id) &&
                        isDrawingToolType(exportData.toolType) &&
                        Array.isArray(exportData.points) &&
                        exportData.points.length > 0
                    );
                } catch {
                    return false;
                }
            });
            if (!hasUserDrawings) {
                return [];
            }
        }

        const exported = parseDrawingToolExports(lineToolsRef.current.exportLineTools?.()).filter(
            (tool) => !isLiveTradeToolId(tool.id)
        );
        if (exported.length > 0) {
            return exported;
        }

        if (!toolsMap || toolsMap.size === 0) return [];

        const fallbackExports: DrawingToolExport[] = [];
        for (const tool of toolsMap.values()) {
            try {
                const exp = tool.getExportData();
                if (
                    exp &&
                    !isLiveTradeToolId(exp.id) &&
                    isDrawingToolType(exp.toolType) &&
                    exp.points?.length > 0
                ) {
                    fallbackExports.push(exp);
                }
            } catch {
                // Skip corrupt tools and keep exporting the rest.
            }
        }

        return fallbackExports;
    }, [getLineToolsInternal, parseDrawingToolExports]);


    const removeAllLineToolsSafely = useCallback(() => {
        const lineTools = lineToolsRef.current;
        if (!lineTools) return;

        try {
            lineTools.removeAllLineTools();
        } catch (error) {
            // Some plugin teardown paths briefly lose chart internals during unmount.
            // Avoid crashing the page while React is disposing the chart.
            console.warn("Failed to remove line tools cleanly:", error);
        }
    }, []);

    const normalizeDrawingTimestampForCurrentData = useCallback((timestamp: number): number => {
        if (!Number.isFinite(timestamp)) {
            return timestamp;
        }

        const normalizedSeconds =
            timestamp >= 1_000_000_000_000
                ? Math.round(timestamp / 1000)
                : Math.round(timestamp);

        if (data.length === 0) {
            return normalizedSeconds;
        }

        const timeframeSeconds = timeframeToSeconds(timeframe);
        const bucketOpenSeconds =
            timeframeSeconds > 0
                ? Math.floor(normalizedSeconds / timeframeSeconds) * timeframeSeconds
                : normalizedSeconds;
        const firstSeconds = Math.round(data[0].timestamp / 1000);
        const lastSeconds = Math.round(data[data.length - 1].timestamp / 1000);

        if (bucketOpenSeconds < firstSeconds || bucketOpenSeconds > lastSeconds) {
            return bucketOpenSeconds;
        }

        let left = 0;
        let right = data.length - 1;

        while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            const midSeconds = Math.round(data[mid].timestamp / 1000);

            if (midSeconds === bucketOpenSeconds) {
                return midSeconds;
            }

            if (midSeconds < bucketOpenSeconds) {
                left = mid + 1;
            } else {
                right = mid - 1;
            }
        }

        const nextSeconds =
            left >= 0 && left < data.length ? Math.round(data[left].timestamp / 1000) : null;
        const previousSeconds =
            right >= 0 && right < data.length ? Math.round(data[right].timestamp / 1000) : null;
        const previousDistance =
            previousSeconds == null ? Number.POSITIVE_INFINITY : Math.abs(previousSeconds - bucketOpenSeconds);
        const nextDistance =
            nextSeconds == null ? Number.POSITIVE_INFINITY : Math.abs(nextSeconds - bucketOpenSeconds);
        const nearestSeconds =
            previousDistance <= nextDistance ? previousSeconds : nextSeconds;

        return nearestSeconds != null && Math.abs(nearestSeconds - bucketOpenSeconds) <= timeframeSeconds
            ? nearestSeconds
            : bucketOpenSeconds;
    }, [data, timeframe]);

    const normalizeDrawingForCurrentData = useCallback((drawing: DrawingToolExport): DrawingToolExport => ({
        ...drawing,
        points: drawing.points.map((point) => ({
            ...point,
            timestamp: normalizeDrawingTimestampForCurrentData(point.timestamp),
        })),
    }), [normalizeDrawingTimestampForCurrentData]);

    const syncLongShortLabelVisibility = useCallback(() => {
        const lineTools = lineToolsRef.current;
        if (drawingsHiddenRef.current || !lineTools) return;

        const selectedIds = new Set(selectedDrawingIdsRef.current);
        const longShortTools = exportCurrentDrawings().filter(
            (tool) => tool.toolType === "LongShortPosition"
        );
        let changed = false;

        for (const tool of longShortTools) {
            const labelsVisible = selectedIds.has(tool.id);
            const currentLabelsVisible = areLongShortLabelsVisible(tool.options);
            const currentShowAutoText =
                typeof tool.options?.showAutoText === "boolean" ? tool.options.showAutoText : currentLabelsVisible;

            if (currentLabelsVisible !== labelsVisible || currentShowAutoText !== labelsVisible) {
                changed = true;
                lineTools.applyLineToolOptions({
                    id: tool.id,
                    toolType: "LongShortPosition",
                    options: {
                        ...withLongShortLabelsVisible(tool.options, labelsVisible),
                        showAutoText: labelsVisible,
                    },
                } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);

                updateLongShortText({
                    id: tool.id,
                    points: tool.points,
                });
            }
        }

        const internalLineTools = getLineToolsInternal();
        const toolsMap = internalLineTools?._tools;
        const interactionManager = internalLineTools?._interactionManager;
        if (!changed || !toolsMap || !interactionManager || selectedIds.size === 0) return;

        let primaryTool: InternalLineTool | null = null;
        const primaryId =
            lastSelectedDrawingRef.current && selectedIds.has(lastSelectedDrawingRef.current.id)
                ? lastSelectedDrawingRef.current.id
                : selectedDrawingIdsRef.current[selectedDrawingIdsRef.current.length - 1];

        for (const tool of toolsMap.values()) {
            const toolId = tool.id();
            const isSelected = selectedIds.has(toolId);
            tool.setSelected(isSelected);
            if (isSelected && toolId === primaryId) {
                primaryTool = tool;
            }
        }

        interactionManager._selectedTool = primaryTool;
        internalLineTools?.requestUpdate?.();
    }, [exportCurrentDrawings, getLineToolsInternal, updateLongShortText]);

    useEffect(() => {
        syncLongShortLabelVisibilityRef.current = syncLongShortLabelVisibility;
    }, [syncLongShortLabelVisibility]);

    const refreshVisibleLongShortDrawings = useCallback(() => {
        if (drawingsHiddenRef.current) return;

        const longShortTools = exportCurrentDrawings().filter(
            (tool) => tool.toolType === "LongShortPosition"
        );
        for (const tool of longShortTools) {
            updateLongShortText({
                id: tool.id,
                points: tool.points,
            });
        }
    }, [exportCurrentDrawings, updateLongShortText]);

    const commitSelectionState = useCallback((selectedTools: DrawingToolExport[]) => {
        selectedDrawingIdsRef.current = selectedTools.map((tool) => tool.id);
        if (selectedTools.length === 0) {
            lastSelectedDrawingRef.current = null;
            onDrawingSelectionChangeRef.current?.(null);
            onRectangleSelectionChangeRef.current?.(false);
            syncLongShortLabelVisibilityRef.current();
            return;
        }

        const lastSelectedId = lastSelectedDrawingRef.current?.id;
        const primaryTool =
            selectedTools.find((tool) => tool.id === lastSelectedId) ??
            selectedTools[selectedTools.length - 1];

        lastSelectedDrawingRef.current = {
            id: primaryTool.id,
            toolType: primaryTool.toolType,
        };
        onDrawingSelectionChangeRef.current?.(primaryTool.toolType);
        onRectangleSelectionChangeRef.current?.(selectedTools.some((tool) => tool.toolType === "Rectangle"));
        syncLongShortLabelVisibilityRef.current();
    }, []);

    const updateDrawingSelection = useCallback(() => {
        if (!lineToolsRef.current) {
            commitSelectionState([]);
            return;
        }

        commitSelectionState(parseDrawingToolExports(lineToolsRef.current.getSelectedLineTools?.()));
    }, [commitSelectionState, parseDrawingToolExports]);

    const readDrawingToolById = useCallback((id: string): DrawingToolExport | null => {
        if (!lineToolsRef.current) return null;
        const matches = parseDrawingToolExports(lineToolsRef.current.getLineToolByID?.(id));
        return matches[0] ?? null;
    }, [parseDrawingToolExports]);

    const getSelectedCalloutConfig = useCallback((): {
        text: string;
        fontSize: number;
        textColor: string;
        lineColor: string;
        boxColor: string;
    } | null => {
        const lineTools = lineToolsRef.current;
        if (!lineTools) return null;

        const selectedTools = parseDrawingToolExports(lineTools.getSelectedLineTools?.());
        const selectedCallout =
            selectedTools.find((tool) => tool.toolType === "Callout") ??
            (lastSelectedDrawingRef.current?.toolType === "Callout" && lastSelectedDrawingRef.current.id
                ? readDrawingToolById(lastSelectedDrawingRef.current.id)
                : null);

        if (!selectedCallout || selectedCallout.toolType !== "Callout") return null;

        const textOptions = (selectedCallout.options as {
            text?: {
                value?: unknown;
                font?: { size?: unknown; color?: unknown };
                box?: { background?: { color?: unknown }; border?: { color?: unknown } };
            };
            line?: { color?: unknown };
        } | undefined)?.text;
        const lineOptions = (selectedCallout.options as {
            line?: { color?: unknown };
            text?: { box?: { border?: { color?: unknown } } };
        } | undefined);

        return {
            text: typeof textOptions?.value === "string" ? textOptions.value : "Text",
            fontSize:
                typeof textOptions?.font?.size === "number" && Number.isFinite(textOptions.font.size)
                    ? textOptions.font.size
                    : 18,
            textColor:
                typeof textOptions?.font?.color === "string"
                    ? textOptions.font.color
                    : "#00ff66",
            lineColor:
                typeof lineOptions?.line?.color === "string"
                    ? lineOptions.line.color
                    : typeof lineOptions?.text?.box?.border?.color === "string"
                        ? lineOptions.text.box.border.color
                        : "#00ff66",
            boxColor:
                typeof textOptions?.box?.background?.color === "string"
                    ? textOptions.box.background.color
                    : "rgba(0,0,0,0.88)",
        };
    }, [parseDrawingToolExports, readDrawingToolById]);

    const updateSelectedCallout = useCallback((config: {
        text?: string;
        fontSize?: number;
        textColor?: string;
        lineColor?: string;
        boxColor?: string;
    }) => {
        const lineTools = lineToolsRef.current;
        if (!lineTools) return;

        const selectedTools = parseDrawingToolExports(lineTools.getSelectedLineTools?.());
        const selectedCallout =
            selectedTools.find((tool) => tool.toolType === "Callout") ??
            (lastSelectedDrawingRef.current?.toolType === "Callout" && lastSelectedDrawingRef.current.id
                ? readDrawingToolById(lastSelectedDrawingRef.current.id)
                : null);

        if (!selectedCallout || selectedCallout.toolType !== "Callout") return;

        const currentConfig = getSelectedCalloutConfig();
        lineTools.applyLineToolOptions({
            id: selectedCallout.id,
            toolType: "Callout",
            options: {
                line: {
                    color: config.lineColor ?? currentConfig?.lineColor ?? "#00ff66",
                },
                text: buildCalloutTextOptions({
                    text: config.text ?? currentConfig?.text ?? "Text",
                    fontSize: config.fontSize ?? currentConfig?.fontSize ?? 18,
                    textColor: config.textColor ?? currentConfig?.textColor ?? "#00ff66",
                    boxColor: config.boxColor ?? currentConfig?.boxColor ?? "rgba(0,0,0,0.88)",
                    lineColor: config.lineColor ?? currentConfig?.lineColor ?? "#00ff66",
                }),
            },
        } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
    }, [getSelectedCalloutConfig, parseDrawingToolExports, readDrawingToolById]);

    const syncImportedDrawings = useCallback((drawings: DrawingToolExport[]) => {
        const lineTools = lineToolsRef.current;
        if (!lineTools) return;

        const normalizedDrawings = drawings.map(normalizeDrawingForCurrentData);

        if (drawingsHiddenRef.current) {
            hiddenDrawingsRef.current = normalizedDrawings;
            const visibleIds = exportCurrentDrawings().map((drawing) => drawing.id);
            if (visibleIds.length > 0) {
                removeLineToolsByIdSafely(visibleIds);
            }
            updateDrawingSelection();
            scheduleTimeGuideOverlayRefreshRef.current();
            return;
        }

        const toolsMap = getLineToolsInternal()?._tools;
        const incomingIds = new Set(normalizedDrawings.map((drawing) => drawing.id));
        const staleIds: string[] = [];

        if (toolsMap) {
            for (const tool of toolsMap.values()) {
                let exportData: DrawingToolExport;
                try {
                    exportData = tool.getExportData();
                } catch {
                    continue;
                }

                if (isDrawingToolType(exportData.toolType) && !incomingIds.has(tool.id())) {
                    if (isLiveTradeToolId(tool.id())) {
                        continue;
                    }
                    staleIds.push(tool.id());
                }
            }
        }

        if (staleIds.length > 0) {
            removeLineToolsByIdSafely(staleIds);
        }

        if (normalizedDrawings.length > 0) {
            lineTools.importLineTools?.(JSON.stringify(normalizedDrawings));
        }

        updateDrawingSelection();
        refreshVisibleLongShortDrawings();
        scheduleTimeGuideOverlayRefreshRef.current();
    }, [
        exportCurrentDrawings,
        getLineToolsInternal,
        normalizeDrawingForCurrentData,
        refreshVisibleLongShortDrawings,
        removeLineToolsByIdSafely,
        updateDrawingSelection,
    ]);

    const syncSelectionByIds = useCallback((ids: string[], primaryId?: string | null) => {
        const lineTools = getLineToolsInternal();
        const toolsMap = lineTools?._tools;
        const interactionManager = lineTools?._interactionManager;

        if (!lineTools || !toolsMap || !interactionManager) {
            updateDrawingSelection();
            return;
        }

        const uniqueIds = Array.from(new Set(ids)).filter((id) => toolsMap.has(id));
        for (const tool of toolsMap.values()) {
            tool.setSelected(false);
        }

        let primaryTool: InternalLineTool | null = null;
        for (const id of uniqueIds) {
            const tool = toolsMap.get(id);
            if (!tool) continue;
            tool.setSelected(true);
            if (id === (primaryId ?? uniqueIds[uniqueIds.length - 1])) {
                primaryTool = tool;
            }
        }

        interactionManager._selectedTool = primaryTool ?? null;
        lineTools.requestUpdate?.();
        updateDrawingSelection();
    }, [getLineToolsInternal, updateDrawingSelection]);

    const clearAllDrawingSelections = useCallback(() => {
        syncSelectionByIds([]);
    }, [syncSelectionByIds]);

    const applyDrawingsHiddenState = useCallback((hidden: boolean) => {
        drawingsHiddenRef.current = hidden;

        if (hidden) {
            hiddenDrawingsRef.current = exportCurrentDrawings();
            const visibleIds = hiddenDrawingsRef.current.map((drawing) => drawing.id);
            if (visibleIds.length > 0) {
                removeLineToolsByIdSafely(visibleIds);
            }
            clearAllDrawingSelections();
            scheduleTimeGuideOverlayRefreshRef.current();
            return;
        }

        if (hiddenDrawingsRef.current.length > 0) {
            syncImportedDrawings(hiddenDrawingsRef.current);
        } else {
            scheduleTimeGuideOverlayRefreshRef.current();
        }
    }, [
        clearAllDrawingSelections,
        exportCurrentDrawings,
        removeLineToolsByIdSafely,
        syncImportedDrawings,
    ]);

    useEffect(() => {
        if (!isChartReady) return;
        applyDrawingsHiddenState(drawingsHidden);
    }, [applyDrawingsHiddenState, drawingsHidden, isChartReady]);

    const deleteSelectedDrawings = useCallback(() => {
        if (!lineToolsRef.current) return;

        lineToolsRef.current.removeSelectedLineTools();
        window.setTimeout(() => {
            clearAllDrawingSelections();
            scheduleTimeGuideOverlayRefreshRef.current();
        }, 0);
    }, [clearAllDrawingSelections]);

    const duplicateDrawings = useCallback((toolsToDuplicate: DrawingToolExport[], offset?: { timestamp: number; price: number }) => {
        if (toolsToDuplicate.length === 0) return [];
        const duplicatedIds: string[] = [];

        for (const tool of toolsToDuplicate) {
            const duplicatedId = lineToolsRef.current?.addLineTool(
                tool.toolType as Parameters<LineToolsApi["addLineTool"]>[0],
                tool.points.map((toolPoint) => ({
                    timestamp: toolPoint.timestamp + (offset?.timestamp ?? 0),
                    price: toolPoint.price + (offset?.price ?? 0),
                })),
                tool.options as Parameters<LineToolsApi["addLineTool"]>[2]
            );
            if (duplicatedId) {
                duplicatedIds.push(duplicatedId);
            }
        }

        return duplicatedIds;
    }, []);

    const getChartPointFromClient = useCallback((clientX: number, clientY: number) => {
        if (!containerRef.current) return null;
        const rect = containerRef.current.getBoundingClientRect();
        return {
            x: clientX - rect.left,
            y: clientY - rect.top,
        };
    }, []);

    const getDrawingSelectionBounds = useCallback((drawing: DrawingToolExport): SelectionBoxBounds | null => {
        const chart = chartRef.current;
        const series = seriesRef.current;
        if (!chart || !series || drawing.points.length === 0) return null;

        let left = Number.POSITIVE_INFINITY;
        let right = Number.NEGATIVE_INFINITY;
        let top = Number.POSITIVE_INFINITY;
        let bottom = Number.NEGATIVE_INFINITY;
        let hasCoordinates = false;

        for (const point of drawing.points) {
            const x = chart.timeScale().timeToCoordinate(drawingTimestampToChartTime(point.timestamp));
            const y = series.priceToCoordinate(point.price);
            if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
                continue;
            }

            hasCoordinates = true;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }

        if (!hasCoordinates) {
            return null;
        }

        return {
            left,
            top,
            width: Math.max(4, right - left),
            height: Math.max(4, bottom - top),
        };
    }, []);

    const getDrawingIdsWithinSelectionBox = useCallback((box: SelectionBoxBounds) => {
        const toolsMap = getLineToolsInternal()?._tools;
        if (!toolsMap) return [];

        const selectedIds: string[] = [];
        for (const tool of toolsMap.values()) {
            let exportData: DrawingToolExport;
            try {
                exportData = tool.getExportData();
            } catch {
                continue;
            }

            if (!isDrawingToolType(exportData.toolType)) {
                continue;
            }

            const normalizedDrawing: DrawingToolExport = normalizeDrawingForCurrentData({
                ...exportData,
                id: tool.id(),
            });
            const drawingBounds = getDrawingSelectionBounds(normalizedDrawing);
            if (drawingBounds && selectionBoxesIntersect(box, drawingBounds)) {
                selectedIds.push(tool.id());
            }
        }

        return selectedIds;
    }, [getDrawingSelectionBounds, getLineToolsInternal, normalizeDrawingForCurrentData]);

    useEffect(() => {
        getDrawingIdsWithinSelectionBoxRef.current = getDrawingIdsWithinSelectionBox;
    }, [getDrawingIdsWithinSelectionBox]);

    const queueSelectionUpdate = useCallback(() => {
        window.setTimeout(() => updateDrawingSelection(), 0);
        window.setTimeout(() => updateDrawingSelection(), 50);
    }, [updateDrawingSelection]);

    useEffect(() => {
        onVisibleRangeChangeRef.current = onVisibleRangeChange;
    }, [onVisibleRangeChange]);

    const scheduleFreePriceScaleMode = useCallback(() => {
        if (typeof window === "undefined") return;
        if (priceScaleUnlockFrameRef.current != null) {
            window.cancelAnimationFrame(priceScaleUnlockFrameRef.current);
        }

        priceScaleUnlockFrameRef.current = window.requestAnimationFrame(() => {
            priceScaleUnlockFrameRef.current = window.requestAnimationFrame(() => {
                const priceScale = seriesRef.current?.priceScale();
                const visibleRange = priceScale?.getVisibleRange();
                if (!priceScale || !visibleRange) return;
                if (!Number.isFinite(visibleRange.from) || !Number.isFinite(visibleRange.to)) return;
                if (visibleRange.from === visibleRange.to) return;

                priceScale.setAutoScale(false);
                priceScale.setVisibleRange(visibleRange);
            });
        });
    }, []);

    const findNearestIndexByTimestamp = useCallback((bars: ChartBar[], timestamp: number): number => {
        if (bars.length === 0) return 0;

        let low = 0;
        let high = bars.length - 1;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            const midTs = bars[mid].timestamp;
            if (midTs === timestamp) return mid;
            if (midTs < timestamp) {
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const leftIndex = Math.max(0, high);
        const rightIndex = Math.min(bars.length - 1, low);
        return Math.abs(bars[leftIndex].timestamp - timestamp) <= Math.abs(bars[rightIndex].timestamp - timestamp)
            ? leftIndex
            : rightIndex;
    }, []);

    const resolveReplayPlacementTimestamp = useCallback((param: ChartMouseEventParam): number | null => {
        const bars = dataRef.current;
        if (bars.length === 0) return null;

        const hoveredSeries = seriesRef.current;
        const hoveredSeriesData =
            hoveredSeries && param.seriesData instanceof Map
                ? param.seriesData.get(hoveredSeries)
                : null;
        if (
            hoveredSeriesData &&
            typeof hoveredSeriesData === "object" &&
            "time" in hoveredSeriesData
        ) {
            const hoveredDate = timeToDate(hoveredSeriesData.time as Time);
            if (hoveredDate) {
                const replayStartIndex = findReplayStartIndex(bars, hoveredDate.getTime());
                return bars[replayStartIndex]?.timestamp ?? null;
            }
        }

        const rawTime =
            param.time ??
            (param.point ? chartRef.current?.timeScale().coordinateToTime(param.point.x) ?? null : null);
        const date = timeToDate(rawTime);
        if (!date) return null;

        const replayStartIndex = findReplayStartIndex(bars, date.getTime());
        return bars[replayStartIndex]?.timestamp ?? null;
    }, []);

    const toCandlestickPoint = useCallback((bar: ChartBar): CandlestickData<Time> => ({
        time: (bar.timestamp / 1000) as Time,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
    }), []);

    const isAppendOnlyUpdate = useCallback((previousBars: ChartBar[], nextBars: ChartBar[]) => {
        if (previousBars.length === 0 || nextBars.length <= previousBars.length) {
            return false;
        }

        for (let index = 0; index < previousBars.length; index += 1) {
            const previousBar = previousBars[index];
            const nextBar = nextBars[index];
            if (
                previousBar.timestamp !== nextBar.timestamp ||
                previousBar.open !== nextBar.open ||
                previousBar.high !== nextBar.high ||
                previousBar.low !== nextBar.low ||
                previousBar.close !== nextBar.close
            ) {
                return false;
            }
        }

        return nextBars[nextBars.length - 1].timestamp > previousBars[previousBars.length - 1].timestamp;
    }, []);

    const isLastBarMutationUpdate = useCallback((previousBars: ChartBar[], nextBars: ChartBar[]) => {
        if (previousBars.length === 0 || nextBars.length !== previousBars.length) {
            return false;
        }

        const lastIndex = previousBars.length - 1;
        for (let index = 0; index < lastIndex; index += 1) {
            const previousBar = previousBars[index];
            const nextBar = nextBars[index];
            if (
                previousBar.timestamp !== nextBar.timestamp ||
                previousBar.open !== nextBar.open ||
                previousBar.high !== nextBar.high ||
                previousBar.low !== nextBar.low ||
                previousBar.close !== nextBar.close
            ) {
                return false;
            }
        }

        const previousLastBar = previousBars[lastIndex];
        const nextLastBar = nextBars[lastIndex];
        if (previousLastBar.timestamp !== nextLastBar.timestamp) {
            return false;
        }

        return (
            previousLastBar.open !== nextLastBar.open ||
            previousLastBar.high !== nextLastBar.high ||
            previousLastBar.low !== nextLastBar.low ||
            previousLastBar.close !== nextLastBar.close
        );
    }, []);

    const getPrependedBarCount = useCallback((previousBars: ChartBar[], nextBars: ChartBar[]) => {
        if (previousBars.length === 0 || nextBars.length <= previousBars.length) {
            return 0;
        }

        const prependedCount = nextBars.length - previousBars.length;
        for (let index = 0; index < previousBars.length; index += 1) {
            const previousBar = previousBars[index];
            const nextBar = nextBars[index + prependedCount];
            if (
                !nextBar ||
                previousBar.timestamp !== nextBar.timestamp ||
                previousBar.open !== nextBar.open ||
                previousBar.high !== nextBar.high ||
                previousBar.low !== nextBar.low ||
                previousBar.close !== nextBar.close
            ) {
                return 0;
            }
        }

        return prependedCount;
    }, []);

    // Convert ChartBar data to Lightweight Charts format.
    // Data from MT5 history is already sorted and deduplicated, so skip the expensive sort+Map.
    const formatData = useCallback((bars: ChartBar[]): Array<CandlestickData<Time> | WhitespaceData<Time>> => {
        const formattedBars: Array<CandlestickData<Time> | WhitespaceData<Time>> = bars.map(toCandlestickPoint);
        if (replayFutureTimestamps.length === 0) {
            return formattedBars;
        }

        return [
            ...formattedBars,
            ...replayFutureTimestamps.map((timestamp) => ({
                time: (timestamp / 1000) as Time,
            })),
        ];
    }, [replayFutureTimestamps, toCandlestickPoint]);

    // Scroll chart to center on trade timeframe
    const scrollToTrade = useCallback((zoomOutMultiplier = 3.2) => {
        if (!chartRef.current || !trade || data.length === 0) return;

        const openTs = trade.openTime instanceof Date ? trade.openTime.getTime() : new Date(trade.openTime).getTime();
        const closeTs = trade.closeTime
            ? (trade.closeTime instanceof Date ? trade.closeTime.getTime() : new Date(trade.closeTime).getTime())
            : openTs;

        const openSec = openTs / 1000;
        const closeSec = closeTs / 1000;
        const tradeDuration = Math.max(closeSec - openSec, 60); // At least 1 minute
        // Start zoomed out to provide enough market context around the trade.
        const minWindow = 2 * 60 * 60 * (zoomOutMultiplier / 3.2); // scale from 2h baseline
        const totalWindow = Math.max(tradeDuration * zoomOutMultiplier, minWindow);
        const center = (openSec + closeSec) / 2;
        const halfWindow = totalWindow / 2;

        chartRef.current.timeScale().setVisibleRange({
            from: (center - halfWindow) as Time,
            to: (center + halfWindow) as Time,
        });
    }, [trade, data.length]);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;
        const chartContainer = containerRef.current;

        const chart = createChart(chartContainer, {
            width: Math.max(chartContainer.clientWidth, 1),
            height: heightRef.current,
            layout: {
                background: { type: ColorType.Solid, color: "#000000" }, // Pure Black
                textColor: "#9ca3af",
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: "#000000" }, // Pure Black Grid (Invisible/Matches BG)
                horzLines: { color: "#000000" }, // Pure Black Grid
            },
            crosshair: {
                mode: CrosshairMode.Normal, // Follows cursor position
                vertLine: {
                    color: "#6b7280",
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: "#374151",
                },
                horzLine: {
                    color: "#6b7280",
                    width: 1,
                    style: LineStyle.Dashed,
                    labelBackgroundColor: "#374151",
                },
            },
            rightPriceScale: {
                autoScale: true,
                borderColor: "#374151",
                scaleMargins: { top: 0.15, bottom: 0.15 },
                entireTextOnly: false,
                minimumWidth: 70,
            },
            timeScale: {
                borderColor: "#374151",
                timeVisible: true,
                secondsVisible: false,
            },
            localization: {
                timeFormatter: formatCrosshairDateTime,
                priceFormatter: (price: number) => {
                    // Format price with thousand separators
                    // Determine decimal places based on price magnitude and typical trading ranges
                    let decimals = 5; // Default for FX pairs (e.g., 1.23456)
                    
                    if (price >= 100) {
                        decimals = 3; // JPY pairs (e.g., 147.559)
                    }
                    if (price >= 1000) {
                        decimals = 2; // Metals like XAUUSD (e.g., 3,412.70)
                    }
                    if (price >= 10000) {
                        decimals = 1; // Indices like US30 (e.g., 44,824.6)
                    }
                    if (price >= 100000) {
                        decimals = 0; // Very large indices (e.g., 429,503)
                    }
                    
                    return price.toLocaleString(undefined, {
                        minimumFractionDigits: decimals,
                        maximumFractionDigits: decimals,
                    });
                },
            },
        });

        // Add candlestick series (User Specified Colors)
        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#dbdbdb",           // Bullish: Light Gray/Off-White
            downColor: "#636363",         // Bearish: Dark Gray
            borderUpColor: "#dbdbdb",
            borderDownColor: "#636363",
            wickUpColor: "#dbdbdb",
            wickDownColor: "#636363",
            priceFormat,
        });

        chartRef.current = chart;
        seriesRef.current = series;

        const chartElement = chart.chartElement();
        let bridgedPointerId: number | null = null;
        let bridgedTouchInteractionActive = false;
        let lastTouchUpTime = 0;
        let lastTouchUpPoint: { x: number; y: number } | null = null;
        const TOUCH_DBL_TAP_MS = 320;
        const TOUCH_DBL_TAP_DISTANCE = 18;

        const dispatchSyntheticMouseEvent = (
            target: EventTarget,
            type: "mousedown" | "mousemove" | "mouseup" | "dblclick",
            event: PointerEvent
        ) => {
            target.dispatchEvent(
                new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    screenX: event.screenX,
                    screenY: event.screenY,
                    ctrlKey: event.ctrlKey,
                    shiftKey: event.shiftKey,
                    altKey: event.altKey,
                    metaKey: event.metaKey,
                    button: 0,
                    buttons: type === "mouseup" || type === "dblclick" ? 0 : 1,
                })
            );
        };

        const handleTouchBridgePointerDown = (event: PointerEvent) => {
            if (event.pointerType === "mouse" || !event.isPrimary) return;
            const point = getChartPointFromClient(event.clientX, event.clientY);
            const hitToolId = point
                ? getLineToolsInternal()?._interactionManager?._hitTest?.(point)?.tool?.id() ?? null
                : null;
            if (!shouldBridgeTouchInteraction({ hitToolId })) return;
            bridgedPointerId = event.pointerId;
            bridgedTouchInteractionActive = true;
            applyChartInteractionLock(true);
            event.preventDefault();
            dispatchSyntheticMouseEvent(chartElement, "mousedown", event);
        };

        const handleTouchBridgePointerMove = (event: PointerEvent) => {
            if (event.pointerType === "mouse" || event.pointerId !== bridgedPointerId) return;
            if (!bridgedTouchInteractionActive) return;
            event.preventDefault();
            dispatchSyntheticMouseEvent(chartElement, "mousemove", event);
        };

        const handleTouchBridgePointerUp = (event: PointerEvent) => {
            if (event.pointerType === "mouse" || event.pointerId !== bridgedPointerId) return;
            if (bridgedTouchInteractionActive) {
                event.preventDefault();
                dispatchSyntheticMouseEvent(window, "mouseup", event);
            }

            const now = performance.now();
            const nextPoint = { x: event.clientX, y: event.clientY };
            const isDoubleTap =
                lastTouchUpPoint != null &&
                now - lastTouchUpTime <= TOUCH_DBL_TAP_MS &&
                Math.hypot(nextPoint.x - lastTouchUpPoint.x, nextPoint.y - lastTouchUpPoint.y) <= TOUCH_DBL_TAP_DISTANCE;

            if (isDoubleTap) {
                dispatchSyntheticMouseEvent(chartElement, "dblclick", event);
                lastTouchUpPoint = null;
                lastTouchUpTime = 0;
            } else {
                lastTouchUpPoint = nextPoint;
                lastTouchUpTime = now;
            }

            bridgedPointerId = null;
            bridgedTouchInteractionActive = false;
            applyChartInteractionLock(false);
        };

        chartContainer.addEventListener("pointerdown", handleTouchBridgePointerDown, true);
        chartContainer.addEventListener("pointermove", handleTouchBridgePointerMove, true);
        window.addEventListener("pointerup", handleTouchBridgePointerUp, true);
        window.addEventListener("pointercancel", handleTouchBridgePointerUp, true);

        const lineTools = createLineToolsPlugin(chart, series);
        lineTools.registerLineTool("Rectangle", LineToolRectangle);
        registerLinesPlugin(lineTools as Parameters<typeof registerLinesPlugin>[0]);
        lineTools.registerLineTool("Brush", PreciseBrushTool);
        lineTools.registerLineTool(
            "Gan" as Parameters<LineToolsApi["registerLineTool"]>[0],
            GanLevelsTool as Parameters<LineToolsApi["registerLineTool"]>[1]
        );
        registerPathPlugin(lineTools as Parameters<typeof registerPathPlugin>[0]);
        lineTools.registerLineTool("LongShortPosition", StableLongShortPosition);
        lineToolsRef.current = lineTools;

        const handleAfterEdit = (params: {
            selectedLineTool?: { id: string; toolType: string; points?: Array<{ timestamp?: number; price?: number }> };
            stage?: string;
        }) => {
            const rawToolType = params?.selectedLineTool?.toolType;
            if (!rawToolType || !isDrawingToolType(rawToolType)) {
                queueSelectionUpdate();
                return;
            }

            const toolType = rawToolType;
            const toolId = params?.selectedLineTool?.id;
            if (toolId) {
                lastSelectedDrawingRef.current = { id: toolId, toolType };
            }

            const isFinishedStage =
                params.stage === "lineToolFinished" ||
                (toolType === "Path" && params.stage === "pathFinished");

            if (params.stage === "lineToolEdited" && toolId) {
                const draggedPointIndex = getLineToolsInternal()?._interactionManager?._draggedPointIndex ?? null;
                const nextPoints = (params.selectedLineTool?.points ?? [])
                    .filter((point): point is DrawingPoint =>
                        point != null &&
                        Number.isFinite(point.timestamp) &&
                        Number.isFinite(point.price)
                    )
                    .map((point) => ({
                        timestamp: point.timestamp,
                        price: point.price,
                    }));

                if (selectionSnapshotRef.current && selectionSnapshotRef.current.size > 1) {
                    const originalTool = selectionSnapshotRef.current.get(toolId);
                    const selectionIdsToKeep = Array.from(selectionSnapshotRef.current.keys());

                    if (draggedPointIndex == null && originalTool && originalTool.points.length > 0 && nextPoints.length > 0) {
                        const timestampDelta = nextPoints[0].timestamp - originalTool.points[0].timestamp;
                        const priceDelta = nextPoints[0].price - originalTool.points[0].price;

                        if (timestampDelta !== 0 || priceDelta !== 0) {
                            for (const [selectedId, selectedTool] of selectionSnapshotRef.current.entries()) {
                                if (selectedId === toolId) continue;
                                lineTools.applyLineToolOptions({
                                    id: selectedId,
                                    toolType: selectedTool.toolType,
                                    points: selectedTool.points.map((point) => ({
                                        timestamp: point.timestamp + timestampDelta,
                                        price: point.price + priceDelta,
                                    })),
                                } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                            }

                            window.setTimeout(() => {
                                syncSelectionByIds(selectionIdsToKeep, toolId);
                            }, 0);
                        }
                    }
                }
            }
            selectionSnapshotRef.current = null;

            if (toolType === "Rectangle" && params.stage === "lineToolFinished") {
                if (!toolId) {
                    queueSelectionUpdate();
                    return;
                }
                lineTools.applyLineToolOptions({
                    id: toolId,
                    toolType: "Rectangle",
                    options: {
                        showPriceAxisLabels: false,
                        showTimeAxisLabels: false,
                    },
                } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                const fill = rectangleFillColorRef.current;
                const border = rectangleBorderColorRef.current;
                if (fill || border) {
                    lineTools.applyLineToolOptions({
                        id: toolId,
                        toolType: "Rectangle",
                        options: {
                            rectangle: {
                                ...(fill ? { background: { color: fill } } : {}),
                                ...(border ? { border: { color: border } } : {}),
                            },
                        },
                    } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                }
            }

            if (
                (toolType === "Gan" && params.stage === "lineToolFinished") ||
                (toolType === "TrendLine" && params.stage === "lineToolFinished") ||
                (toolType === "HorizontalRay" && params.stage === "lineToolFinished") ||
                (toolType === "Brush" && params.stage === "lineToolFinished") ||
                (toolType === "Path" && (params.stage === "pathFinished" || params.stage === "lineToolFinished")) ||
                (toolType === "Callout" && params.stage === "lineToolFinished")
            ) {
                const lineColor =
                    toolType === "Callout"
                        ? calloutLineColorRef.current
                        : drawingLineColorRef.current;
                if (toolId) {
                    lineTools.applyLineToolOptions({
                        id: toolId,
                        toolType,
                        options: {
                            showPriceAxisLabels: false,
                            showTimeAxisLabels: false,
                            ...(lineColor ? { line: { color: lineColor } } : {}),
                            ...(toolType === "Callout"
                                ? {
                                      text: buildCalloutTextOptions({
                                          text: calloutTextRef.current || "Text",
                                          fontSize: calloutFontSizeRef.current || 18,
                                          textColor: calloutTextColorRef.current || "#00ff66",
                                          boxColor: calloutBoxColorRef.current || "rgba(0,0,0,0.88)",
                                          lineColor: calloutLineColorRef.current || "#00ff66",
                                      }),
                                  }
                                : {}),
                        },
                    } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                }
            }

            if (toolType === "LongShortPosition" && params.selectedLineTool?.points) {
                const liveMeta = liveTradeLineMetaRef.current.get(params.selectedLineTool.id);
                updateLongShortText({
                    id: params.selectedLineTool.id,
                    points: params.selectedLineTool.points as Array<{ price: number }>,
                });
            }

            if (toolType === "HorizontalRay" && params.selectedLineTool?.points) {
                const liveMeta = liveTradeLineMetaRef.current.get(params.selectedLineTool.id);
                if (liveMeta) {
                    const toolId = params.selectedLineTool.id;
                    const pendingTimer = liveTradeAmendTimersRef.current.get(toolId);
                    if (pendingTimer != null) {
                        window.clearTimeout(pendingTimer);
                    }

                    const nextTimer = window.setTimeout(() => {
                        liveTradeAmendTimersRef.current.delete(toolId);
                        const latestTool = readDrawingToolById(toolId);
                        const nextPrice = latestTool?.points?.[0]?.price;
                        if (!Number.isFinite(nextPrice)) return;
                        const nextValidatedPrice = nextPrice as number;

                        if (liveMeta.kind === "position-stopLoss") {
                            const position = activeLivePositionsRef.current.find((p) => p.positionId === liveMeta.positionId);
                            void onActiveLivePositionChangeRef.current?.(
                                liveMeta.positionId,
                                nextValidatedPrice,
                                position?.takeProfit ?? undefined
                            );
                            return;
                        }

                        if (liveMeta.kind === "position-takeProfit") {
                            const position = activeLivePositionsRef.current.find((p) => p.positionId === liveMeta.positionId);
                            void onActiveLivePositionChangeRef.current?.(
                                liveMeta.positionId,
                                position?.stopLoss ?? undefined,
                                nextValidatedPrice
                            );
                            return;
                        }

                        if (liveMeta.kind === "order-entry") {
                            const order = activeLiveOrdersRef.current.find((o) => o.orderId === liveMeta.orderId);
                            void onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                                ...(String(liveMeta.orderType).toUpperCase().includes("LIMIT")
                                    ? { limitPrice: nextValidatedPrice }
                                    : { stopPrice: nextValidatedPrice }),
                                stopLoss: order?.stopLoss ?? undefined,
                                takeProfit: order?.takeProfit ?? undefined,
                            });
                            return;
                        }

                        if (liveMeta.kind === "order-stopLoss") {
                            const order = activeLiveOrdersRef.current.find((o) => o.orderId === liveMeta.orderId);
                            void onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                                takeProfit: order?.takeProfit ?? undefined,
                                stopLoss: nextValidatedPrice,
                            });
                            return;
                        }

                        if (liveMeta.kind === "order-takeProfit") {
                            const order = activeLiveOrdersRef.current.find((o) => o.orderId === liveMeta.orderId);
                            void onActiveLiveOrderChangeRef.current?.(liveMeta.orderId, {
                                stopLoss: order?.stopLoss ?? undefined,
                                takeProfit: nextValidatedPrice,
                            });
                            return;
                        }

                        if (liveMeta.kind === "alert-target") {
                            void onActivePriceAlertChangeRef.current?.(
                                liveMeta.alertId,
                                nextValidatedPrice,
                                liveMeta.priceSide
                            );
                        }
                    }, 180);

                    liveTradeAmendTimersRef.current.set(toolId, nextTimer);
                }
            }

            if (isFinishedStage) {
                window.setTimeout(() => {
                    if (toolId) {
                        syncSelectionByIds([toolId], toolId);
                    } else {
                        queueSelectionUpdate();
                    }
                    if (!continuousDrawingRef.current) {
                        skipNextCancelActiveDrawingRef.current = true;
                    }
                    onDrawingToolCompleteRef.current?.(toolType);
                    if (
                        continuousDrawingRef.current &&
                        drawingToolRef.current === toolType &&
                        lineToolsRef.current
                    ) {
                        lineToolsRef.current.addLineTool(
                            toolType as Parameters<LineToolsApi["addLineTool"]>[0],
                            undefined,
                            buildDrawingToolOptions(toolType)
                        );
                    }
                    scheduleTimeGuideOverlayRefreshRef.current();
                }, 0);
                return;
            }

            queueSelectionUpdate();
            scheduleTimeGuideOverlayRefreshRef.current();
        };
        const handleDoubleClick = (params: {
            selectedLineTool?: {
                id: string;
                toolType: string;
                options?: unknown;
            };
        }) => {
            const rawToolType = params?.selectedLineTool?.toolType;
            if (rawToolType && isDrawingToolType(rawToolType)) {
                const toolType = rawToolType;
                const toolId = params?.selectedLineTool?.id;
                if (toolId) {
                    lastSelectedDrawingRef.current = { id: toolId, toolType };
                }
                if (toolType === "Callout") {
                    window.setTimeout(() => {
                        onCalloutEditRequestRef.current?.();
                    }, 0);
                }
            }
            queueSelectionUpdate();
        };
        const handleChartClick = (param: ChartMouseEventParam) => {
            if (replayPlacementModeRef.current) {
                const replayTimestamp =
                    replayPlacementTimestampRef.current ?? resolveReplayPlacementTimestamp(param);
                if (replayTimestamp != null) {
                    onReplayPlacementSelectRef.current?.(replayTimestamp);
                }
                return;
            }

            const clickedTime = param.time ? Number(param.time) * 1000 : null;
            if (clickedTime) {
                const tradeHistory = tradeHistoryRef.current;
                const onTradeHistoryClick = onTradeHistoryClickRef.current;
                if (tradeHistory && onTradeHistoryClick) {
                    const matchedTrades = tradeHistory.filter((t) => {
                        const openTime = new Date(t.openTime).getTime();
                        const closeTime = t.closeTime
                            ? new Date(t.closeTime).getTime()
                            : openTime;
                        return clickedTime >= openTime && clickedTime <= closeTime;
                    }).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
                    if (matchedTrades.length > 0) {
                        const lastTs = clickCycleTimestampRef.current;
                        const timeThreshold = 500;
                        if (lastTs != null && Math.abs(clickedTime - lastTs) <= timeThreshold) {
                            clickCycleIndexRef.current = (clickCycleIndexRef.current + 1) % matchedTrades.length;
                        } else {
                            clickCycleIndexRef.current = 0;
                        }
                        clickCycleTimestampRef.current = clickedTime;
                        onTradeHistoryClick(matchedTrades[clickCycleIndexRef.current]);
                        return;
                    }
                }
            }
            clickCycleTimestampRef.current = null;
            clickCycleIndexRef.current = 0;

            window.setTimeout(() => {
                const selectedRaw = lineTools.getSelectedLineTools?.();
                if (!selectedRaw) return;
                try {
                    const selectedTools = JSON.parse(selectedRaw) as Array<{ id: string; toolType: string }>;
                    const match = selectedTools.find((tool) =>
                        tool.toolType === "Rectangle" ||
                        tool.toolType === "Gan" ||
                        tool.toolType === "TrendLine" ||
                        tool.toolType === "HorizontalRay" ||
                        tool.toolType === "Path" ||
                        tool.toolType === "Brush" ||
                        tool.toolType === "Callout" ||
                        tool.toolType === "LongShortPosition"
                    ) as { id: string; toolType: DrawingToolType } | undefined;
                    if (match) {
                        lastSelectedDrawingRef.current = { id: match.id, toolType: match.toolType };
                    }
                } catch {
                    // ignore
                }
                queueSelectionUpdate();
            }, 0);
        };
        const handleCrosshairMove = (param: ChartMouseEventParam) => {
            if (replayPlacementModeRef.current) {
                onReplayPlacementPreviewChangeRef.current?.(resolveReplayPlacementTimestamp(param));
            }

            if (!canShowCrosshairQuickActionsRef.current || liveTradeDragSessionRef.current) {
                scheduleCrosshairQuickAction(null);
                return;
            }

            const point = param.point;
            const paneSize = chart.paneSize();
            if (
                !point ||
                point.x < 0 ||
                point.y < 0 ||
                point.x > paneSize.width ||
                point.y > paneSize.height
            ) {
                return;
            }

            const mappedPrice = series.coordinateToPrice(point.y);
            const price =
                typeof mappedPrice === "number" ? mappedPrice : Number(mappedPrice);
            if (!Number.isFinite(price)) {
                return;
            }

            scheduleCrosshairQuickAction({
                y: point.y,
                price,
            });
        };
        lineTools.subscribeLineToolsAfterEdit?.(handleAfterEdit);
        lineTools.subscribeLineToolsDoubleClick?.(handleDoubleClick);
        chart.subscribeClick(handleChartClick);
        chart.subscribeCrosshairMove(handleCrosshairMove);

        const handlePointerDown = (event: PointerEvent) => {
            const point = getChartPointFromClient(event.clientX, event.clientY);
            const hitToolId = point
                ? getLineToolsInternal()?._interactionManager?._hitTest?.(point)?.tool?.id()
                : undefined;
            const toolCreating = Boolean(getLineToolsInternal()?._interactionManager?._currentToolCreating);
            const isPrimaryPointer = isPrimaryDrawingPointer(event);
            const isTouchLikePointer = event.pointerType !== "mouse";

            pointerGestureRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                button: event.button,
                pointerType: event.pointerType,
                ctrlOrMeta: isSelectionModifierPressed(event),
                selectedIds: [...selectedDrawingIdsRef.current],
            };
            selectionBoxDragRef.current = null;
            setSelectionBox(null);

            if (!point || !isPrimaryPointer) {
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                queueSelectionUpdate();
                return;
            }

            if (isTouchLikePointer) {
                if (!shouldBridgeTouchInteraction({ hitToolId })) {
                    selectionSnapshotRef.current = null;
                    duplicateDragPlanRef.current = null;
                    return;
                }
                event.preventDefault();
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                queueSelectionUpdate();
                return;
            }

            if (isSelectionModifierPressed(event) && hitToolId && selectedDrawingIdsRef.current.includes(hitToolId)) {
                const selectedTools = selectedDrawingIdsRef.current
                    .map((id) => readDrawingToolById(id))
                    .filter((tool): tool is DrawingToolExport => tool !== null);
                const selectionMap = new Map(selectedTools.map((tool) => [tool.id, tool] as const));
                duplicateDragPlanRef.current =
                    selectionMap.size > 0
                        ? {
                              selection: selectionMap,
                              primaryId: hitToolId,
                          }
                        : null;
                selectionSnapshotRef.current = null;
                queueSelectionUpdate();
                return;
            }

            duplicateDragPlanRef.current = null;
            if (selectedDrawingIdsRef.current.length > 1 && hitToolId && selectedDrawingIdsRef.current.includes(hitToolId)) {
                selectionSnapshotRef.current = new Map(
                    selectedDrawingIdsRef.current
                        .map((id) => {
                            const tool = readDrawingToolById(id);
                            return tool ? ([id, tool] as const) : null;
                        })
                        .filter((entry): entry is readonly [string, DrawingToolExport] => entry !== null)
                );
            } else {
                selectionSnapshotRef.current = null;
            }

            if (isSelectionModifierPressed(event) && !hitToolId && !toolCreating) {
                selectionBoxDragRef.current = {
                    startPoint: point,
                    currentPoint: point,
                    additiveSelection: isSelectionModifierPressed(event),
                    initialSelection: [...selectedDrawingIdsRef.current],
                    active: false,
                };
                event.preventDefault();
                event.stopPropagation();
                queueSelectionUpdate();
                return;
            }

            queueSelectionUpdate();
        };
        const handlePointerMove = (event: PointerEvent) => {
            const gesture = pointerGestureRef.current;
            const selectionDrag = selectionBoxDragRef.current;
            if (!gesture || !selectionDrag || (gesture.pointerType === "mouse" && gesture.button !== 0)) {
                return;
            }

            const point = getChartPointFromClient(event.clientX, event.clientY);
            if (!point) {
                return;
            }

            selectionDrag.currentPoint = point;
            const dragDistance = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
            if (!selectionDrag.active && dragDistance <= 5) {
                return;
            }

            selectionDrag.active = true;
            setSelectionBox(normalizeSelectionBox(selectionDrag.startPoint, point));
            event.preventDefault();
            event.stopPropagation();
        };
        const handlePointerUp = (event: PointerEvent) => {
            const gesture = pointerGestureRef.current;
            if (!gesture) {
                return;
            }
            pointerGestureRef.current = null;
            const selectionDrag = selectionBoxDragRef.current;
            selectionBoxDragRef.current = null;
            setSelectionBox(null);

            queueSelectionUpdate();

            const point = getChartPointFromClient(event.clientX, event.clientY);
            if (!point || (gesture.pointerType === "mouse" && gesture.button !== 0)) {
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                return;
            }

            if (selectionDrag?.active) {
                const marqueeSelection = getDrawingIdsWithinSelectionBoxRef.current(
                    normalizeSelectionBox(selectionDrag.startPoint, selectionDrag.currentPoint)
                );
                const nextSelection = selectionDrag.additiveSelection
                    ? Array.from(new Set([...selectionDrag.initialSelection, ...marqueeSelection]))
                    : marqueeSelection;
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                syncSelectionByIds(nextSelection, nextSelection[nextSelection.length - 1] ?? null);
                event.preventDefault();
                event.stopPropagation();
                return;
            }

            if (selectionDrag) {
                event.preventDefault();
                event.stopPropagation();
            }

            const dragDistance = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
            if (dragDistance > 5) {
                const duplicatePlan = duplicateDragPlanRef.current;
                if (duplicatePlan) {
                    window.setTimeout(() => {
                        const movedTools = Array.from(duplicatePlan.selection.keys())
                            .map((id) => readDrawingToolById(id))
                            .filter((tool): tool is DrawingToolExport => tool !== null);

                        for (const originalTool of duplicatePlan.selection.values()) {
                            lineToolsRef.current?.applyLineToolOptions({
                                id: originalTool.id,
                                toolType: originalTool.toolType,
                                points: originalTool.points,
                            } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                        }

                        const duplicateIds = duplicateDrawings(movedTools);
                        if (duplicateIds.length > 0) {
                            const primaryIndex = movedTools.findIndex((tool) => tool.id === duplicatePlan.primaryId);
                            const duplicatePrimaryId =
                                primaryIndex >= 0 ? duplicateIds[primaryIndex] : duplicateIds[duplicateIds.length - 1];
                            syncSelectionByIds(duplicateIds, duplicatePrimaryId);
                        } else {
                            syncSelectionByIds(Array.from(duplicatePlan.selection.keys()), duplicatePlan.primaryId);
                        }
                    }, 0);
                }
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                return;
            }

            if (getLineToolsInternal()?._interactionManager?._currentToolCreating) {
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                return;
            }

            selectionSnapshotRef.current = null;
            window.setTimeout(() => {
                const hitToolId = getLineToolsInternal()?._interactionManager?._hitTest?.(point)?.tool?.id();
                const ctrlOrMeta = isSelectionModifierPressed(event) || gesture.ctrlOrMeta;
                duplicateDragPlanRef.current = null;

                if (ctrlOrMeta) {
                    if (hitToolId) {
                        const nextSelection = gesture.selectedIds.includes(hitToolId)
                            ? gesture.selectedIds.filter((id) => id !== hitToolId)
                            : [...gesture.selectedIds, hitToolId];
                        syncSelectionByIds(nextSelection, nextSelection[nextSelection.length - 1] ?? null);
                        return;
                    }
                    return;
                }

                if (hitToolId) {
                    const isOnlySelectedTool =
                        selectedDrawingIdsRef.current.length === 1 &&
                        selectedDrawingIdsRef.current[0] === hitToolId;
                    if (!isOnlySelectedTool) {
                        syncSelectionByIds([hitToolId], hitToolId);
                    }
                    return;
                }

                clearAllDrawingSelections();
            }, 0);
        };
        chartContainer.addEventListener("pointerdown", handlePointerDown, true);
        chartContainer.addEventListener("pointermove", handlePointerMove, true);
        chartContainer.addEventListener("pointerup", handlePointerUp, true);
        chartContainer.addEventListener("pointercancel", handlePointerUp, true);

        setIsChartReady(true);

        const syncChartSize = () => {
            if (containerRef.current) {
                const width = containerRef.current.clientWidth;
                if (width > 0) {
                    chart.applyOptions({ width, height: heightRef.current });
                }
            }
        };

        // Ensure chart gets correct dimensions after layout transitions (e.g. panel expand).
        syncChartSize();
        const rafId = requestAnimationFrame(syncChartSize);
        const timeoutId = window.setTimeout(syncChartSize, 100);

        const handleResize = () => {
            syncChartSize();
            scheduleTimeGuideOverlayRefreshRef.current();
        };

        window.addEventListener("resize", handleResize);

        const resizeObserver =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => {
                    syncChartSize();
                    scheduleTimeGuideOverlayRefreshRef.current();
                })
                : null;
        if (resizeObserver) {
            resizeObserver.observe(chartContainer);
        }

        const handleVisibleRange = (range: { from: number; to: number } | null) => {
            scheduleTimeGuideOverlayRefreshRef.current();
            if (Date.now() < suppressVisibleRangeUntilRef.current) return;
            const callback = onVisibleRangeChangeRef.current;
            if (!callback) return;
            if (range && range.from !== undefined && range.to !== undefined) {
                callback(range.from, range.to);
            }
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRange);

        return () => {
            clearTradeHistoryPlugins(seriesRef.current);
            lineToolsRef.current?.unsubscribeLineToolsAfterEdit?.(handleAfterEdit);
            lineToolsRef.current?.unsubscribeLineToolsDoubleClick?.(handleDoubleClick);
            removeAllLineToolsSafely();
            chart.unsubscribeClick(handleChartClick);
            chart.unsubscribeCrosshairMove(handleCrosshairMove);
            chartContainer.removeEventListener("pointerdown", handleTouchBridgePointerDown, true);
            chartContainer.removeEventListener("pointermove", handleTouchBridgePointerMove, true);
            window.removeEventListener("pointerup", handleTouchBridgePointerUp, true);
            window.removeEventListener("pointercancel", handleTouchBridgePointerUp, true);
            chartContainer.removeEventListener("pointerdown", handlePointerDown, true);
            chartContainer.removeEventListener("pointermove", handlePointerMove, true);
            chartContainer.removeEventListener("pointerup", handlePointerUp, true);
            chartContainer.removeEventListener("pointercancel", handlePointerUp, true);
            touchInteractionLockedRef.current = false;
            lineToolsRef.current = null;
            window.removeEventListener("resize", handleResize);
            window.clearTimeout(timeoutId);
            cancelAnimationFrame(rafId);
            if (overlayFrameRef.current != null) {
                cancelAnimationFrame(overlayFrameRef.current);
                overlayFrameRef.current = null;
            }
            if (crosshairQuickActionFrameRef.current != null) {
                cancelAnimationFrame(crosshairQuickActionFrameRef.current);
                crosshairQuickActionFrameRef.current = null;
            }
            if (priceScaleUnlockFrameRef.current != null) {
                cancelAnimationFrame(priceScaleUnlockFrameRef.current);
                priceScaleUnlockFrameRef.current = null;
            }
            for (const timerId of liveTradeAmendTimersRef.current.values()) {
                window.clearTimeout(timerId);
            }
            liveTradeAmendTimersRef.current.clear();
            liveTradeLineMetaRef.current.clear();
            if (seriesRef.current) {
                for (const priceLine of liveTradePriceLinesRef.current.values()) {
                    try {
                        seriesRef.current.removePriceLine(priceLine);
                    } catch {
                        // ignore
                    }
                }
            }
            liveTradePriceLinesRef.current.clear();
            resizeObserver?.disconnect();
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRange);
            entryLineRef.current = null;
            stopLossLineRef.current = null;
            exitLineRef.current = null;
            riskRewardPluginRef.current = null;
            tradeHistoryPluginsRef.current = [];
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            setIsChartReady(false);
        };
    }, [
        buildDrawingToolOptions,
        clearAllDrawingSelections,
        duplicateDrawings,
        getChartPointFromClient,
        getSelectedCalloutConfig,
        getLineToolsInternal,
        queueSelectionUpdate,
        readDrawingToolById,
        removeAllLineToolsSafely,
        shouldBridgeTouchInteraction,
        syncSelectionByIds,
        updateLongShortText,
        clearTradeHistoryPlugins,
    ]);

    useEffect(() => {
        if (!seriesRef.current) return;
        seriesRef.current.applyOptions({ priceFormat });
    }, [priceFormat]);

    useEffect(() => {
        const timeScale = chartRef.current?.timeScale();
        if (!timeScale) return;
        timeScale.applyOptions({
            rightOffset: replayRightOffsetBars,
            rightBarStaysOnScroll: replayRightOffsetBars > 0,
        });
    }, [replayRightOffsetBars]);

    useEffect(() => {
        if (!seriesRef.current) return;
        seriesRef.current.applyOptions({
            lastValueVisible: !useCustomLivePriceStack,
            priceLineVisible: !useCustomLivePriceStack,
        });
    }, [useCustomLivePriceStack]);

    useEffect(() => {
        const lineTools = lineToolsRef.current;
        const series = seriesRef.current;
        if (!isChartReady || !lineTools || !series) {
            return;
        }

        const nextLiveToolIds = new Set<string>();
        const nextPriceLineIds = new Set<string>();
        const nextLiveLineSpecs: LiveTradeLineSpec[] = [];

        const pushSpec = (spec: LiveTradeLineSpec) => {
            nextLiveLineSpecs.push(spec);
            nextPriceLineIds.add(spec.id);
        };

        for (const position of activeLivePositions) {
            if (!Number.isFinite(position.entryPrice)) {
                continue;
            }

            const entryPrice = position.entryPrice as number;
            pushSpec({
                id: `${LIVE_TRADE_TOOL_ID_PREFIX}position-entry:${position.positionId}`,
                price: entryPrice,
                title: formatLiveTradeTitle(position.lots, `${position.direction}`),
                color: "rgba(59, 130, 246, 0.95)",
                lineStyle: LineStyle.Solid,
                editable: false,
            });

            if (Number.isFinite(position.stopLoss)) {
                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}position-sl:${position.positionId}`;
                nextLiveToolIds.add(toolId);
                pushSpec({
                    id: toolId,
                    price: position.stopLoss as number,
                    title: "SL",
                    color: "rgba(245, 158, 11, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: {
                        kind: "position-stopLoss",
                        positionId: position.positionId,
                    },
                });
            }

            if (Number.isFinite(position.takeProfit)) {
                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}position-tp:${position.positionId}`;
                nextLiveToolIds.add(toolId);
                pushSpec({
                    id: toolId,
                    price: position.takeProfit as number,
                    title: "TP",
                    color: "rgba(16, 185, 129, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: {
                        kind: "position-takeProfit",
                        positionId: position.positionId,
                    },
                });
            }
        }

        for (const order of activeLiveOrders) {
            const primaryPrice =
                String(order.orderType).toUpperCase().includes("LIMIT")
                    ? order.limitPrice
                    : order.stopPrice;
            if (!Number.isFinite(primaryPrice)) {
                continue;
            }

            const baseColor =
                String(order.orderType).toUpperCase().includes("LIMIT")
                    ? "rgba(59, 130, 246, 0.95)"
                    : "rgba(168, 85, 247, 0.95)";
            const entryToolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-entry:${order.orderId}`;
            nextLiveToolIds.add(entryToolId);
            pushSpec({
                id: entryToolId,
                price: primaryPrice as number,
                title: formatLiveTradeTitle(
                    order.lots,
                    `${order.direction} ${String(order.orderType).toUpperCase().includes("LIMIT") ? "Limit" : "Stop"}`
                ),
                color: baseColor,
                lineStyle: LineStyle.Solid,
                editable: true,
                toolMeta: {
                    kind: "order-entry",
                    orderId: order.orderId,
                    orderType: order.orderType,
                },
            });

            if (Number.isFinite(order.stopLoss)) {
                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-sl:${order.orderId}`;
                nextLiveToolIds.add(toolId);
                pushSpec({
                    id: toolId,
                    price: order.stopLoss as number,
                    title: "SL",
                    color: "rgba(245, 158, 11, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: {
                        kind: "order-stopLoss",
                        orderId: order.orderId,
                        orderType: order.orderType,
                    },
                });
            }

            if (Number.isFinite(order.takeProfit)) {
                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}order-tp:${order.orderId}`;
                nextLiveToolIds.add(toolId);
                pushSpec({
                    id: toolId,
                    price: order.takeProfit as number,
                    title: "TP",
                    color: "rgba(16, 185, 129, 0.95)",
                    lineStyle: LineStyle.Dotted,
                    editable: true,
                    toolMeta: {
                        kind: "order-takeProfit",
                        orderId: order.orderId,
                        orderType: order.orderType,
                    },
                });
            }
        }

        if (showPriceAlerts) {
            for (const alert of activePriceAlerts) {
                if (!Number.isFinite(alert.targetPrice)) {
                    continue;
                }

                const toolId = `${LIVE_TRADE_TOOL_ID_PREFIX}alert-target:${alert.id}`;
                nextLiveToolIds.add(toolId);
                pushSpec({
                    id: toolId,
                    price: alert.targetPrice,
                    title: alert.note?.trim() || formatAlertCondition(alert.condition),
                    color:
                        alert.condition === "below"
                            ? "rgba(245, 158, 11, 0.95)"
                            : "rgba(14, 165, 233, 0.95)",
                    lineStyle: LineStyle.Dashed,
                    editable: true,
                    toolMeta: {
                        kind: "alert-target",
                        alertId: alert.id,
                        priceSide: alert.priceSide,
                    },
                });
            }
        }

        liveTradeLineSpecsRef.current = new Map(nextLiveLineSpecs.map((spec) => [spec.id, spec]));

        for (const spec of nextLiveLineSpecs) {
            const existingPriceLine = liveTradePriceLinesRef.current.get(spec.id);
            if (existingPriceLine) {
                series.removePriceLine(existingPriceLine);
                liveTradePriceLinesRef.current.delete(spec.id);
            }

            const priceLine = series.createPriceLine({
                price: spec.price,
                color: spec.color,
                lineWidth: 1,
                lineStyle: spec.lineStyle,
                axisLabelVisible: true,
                title: "",
                lineVisible: true,
            });
            liveTradePriceLinesRef.current.set(spec.id, priceLine);

            if (spec.editable && spec.toolMeta) {
                liveTradeLineMetaRef.current.set(spec.id, spec.toolMeta);
            } else {
                liveTradeLineMetaRef.current.delete(spec.id);
            }
        }

        const staleIds = Array.from(liveTradeLineMetaRef.current.keys()).filter(
            (id) => !nextLiveToolIds.has(id)
        );
        if (staleIds.length > 0) {
            removeLineToolsByIdSafely(staleIds);
            for (const staleId of staleIds) {
                liveTradeLineMetaRef.current.delete(staleId);
                const pendingTimer = liveTradeAmendTimersRef.current.get(staleId);
                if (pendingTimer != null) {
                    window.clearTimeout(pendingTimer);
                    liveTradeAmendTimersRef.current.delete(staleId);
                }
            }
        }

        for (const [id, priceLine] of liveTradePriceLinesRef.current.entries()) {
            if (nextPriceLineIds.has(id)) continue;
            series.removePriceLine(priceLine);
            liveTradePriceLinesRef.current.delete(id);
        }
    }, [
        activeLivePositions,
        activeLiveOrders,
        activePriceAlerts,
        data,
        isChartReady,
        normalizeDrawingTimestampForCurrentData,
        removeLineToolsByIdSafely,
        showPriceAlerts,
    ]);

    useEffect(() => {
        if (!isChartReady) {
            setTimeGuideOverlay({ width: null, height: null, verticalLines: [] });
            setReplayPlacementOverlay({ width: null, height: null, x: null });
            return;
        }
        scheduleReplayPlacementOverlayRefresh();
    }, [isChartReady, scheduleReplayPlacementOverlayRefresh, computedTimeGuides, height]);

    useEffect(() => {
        if (!lineToolsRef.current || !drawingTool) return;
        lineToolsRef.current.addLineTool(
            drawingTool as Parameters<LineToolsApi["addLineTool"]>[0],
            undefined,
            buildDrawingToolOptions(drawingTool)
        );
    }, [buildDrawingToolOptions, drawingTool]);

    useEffect(() => {
        if (drawingTool !== "Callout" || !lineToolsRef.current) return;

        const currentToolId = getLineToolsInternal()?._interactionManager?._currentToolCreating?.id();
        if (!currentToolId) return;

        lineToolsRef.current.applyLineToolOptions({
            id: currentToolId,
            toolType: "Callout",
            options: {
                line: {
                    color: calloutLineColor || "#00ff66",
                },
                text: buildCalloutTextOptions({
                    text: calloutText,
                    fontSize: calloutFontSize,
                    textColor: calloutTextColor,
                    boxColor: calloutBoxColor,
                    lineColor: calloutLineColor || "#00ff66",
                }),
            },
        } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
    }, [
        calloutBoxColor,
        calloutFontSize,
        calloutLineColor,
        calloutText,
        calloutTextColor,
        drawingTool,
        getLineToolsInternal,
    ]);

    useEffect(() => {
        applyChartInteractionLock(touchInteractionLockedRef.current);
    }, [applyChartInteractionLock, drawingTool]);

    useEffect(() => {
        if (drawingTool !== null) return;
        if (skipNextCancelActiveDrawingRef.current) {
            skipNextCancelActiveDrawingRef.current = false;
            return;
        }
        cancelActiveDrawing();
    }, [cancelActiveDrawing, drawingTool]);

    useEffect(() => {
        if (!isChartReady || !lineToolsRef.current) return;
        if (!rectangleFillColor && !rectangleBorderColor && !drawingLineColor) return;

        const selectedTools = parseDrawingToolExports(lineToolsRef.current.getSelectedLineTools?.());
        const selectedIds = selectedTools.map((tool) => tool.id);

        const rectangleOptions: { background?: { color: string }; border?: { color: string } } = {};
        if (rectangleFillColor) rectangleOptions.background = { color: rectangleFillColor };
        if (rectangleBorderColor) rectangleOptions.border = { color: rectangleBorderColor };

        const applyToRectangle = (id: string) => {
            if (!rectangleFillColor && !rectangleBorderColor) return;
            lineToolsRef.current?.applyLineToolOptions({
                id,
                toolType: "Rectangle",
                options: {
                    rectangle: rectangleOptions,
                },
            } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
        };

        const applyToLineTool = (id: string, toolType: DrawingToolType) => {
            if (!drawingLineColor) return;
            lineToolsRef.current?.applyLineToolOptions({
                id,
                toolType,
                options: {
                    line: { color: drawingLineColor },
                },
            } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
        };

        const applyToBrush = (id: string) => {
            if (!drawingLineColor) return;
            lineToolsRef.current?.applyLineToolOptions({
                id,
                toolType: "Brush",
                options: {
                    ...(drawingLineColor ? { line: { color: drawingLineColor } } : {}),
                },
            } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
        };

        const selectedTargets = selectedTools.filter(
            (tool) =>
                tool.toolType === "Rectangle" ||
                tool.toolType === "Gan" ||
                tool.toolType === "TrendLine" ||
                tool.toolType === "HorizontalRay" ||
                tool.toolType === "Path" ||
                tool.toolType === "Brush" ||
                tool.toolType === "Callout"
        );

        if (selectedTargets.length > 0) {
            selectedTargets.forEach((tool) => {
                if (tool.toolType === "Rectangle") {
                    applyToRectangle(tool.id);
                } else if (tool.toolType === "Brush") {
                    applyToBrush(tool.id);
                } else if (
                    tool.toolType === "Gan" ||
                    tool.toolType === "TrendLine" ||
                    tool.toolType === "HorizontalRay" ||
                    tool.toolType === "Path" ||
                    tool.toolType === "Callout"
                ) {
                    applyToLineTool(tool.id, tool.toolType);
                }
            });
            window.setTimeout(() => {
                syncSelectionByIds(selectedIds, lastSelectedDrawingRef.current?.id ?? selectedIds[selectedIds.length - 1] ?? null);
            }, 0);
            return;
        }

        const lastSelected = lastSelectedDrawingRef.current;
        if (!lastSelected) return;

        if (lastSelected.toolType === "Rectangle") {
            applyToRectangle(lastSelected.id);
        } else if (lastSelected.toolType === "Brush") {
            applyToBrush(lastSelected.id);
        } else if (
            lastSelected.toolType === "Gan" ||
            lastSelected.toolType === "TrendLine" ||
            lastSelected.toolType === "HorizontalRay" ||
            lastSelected.toolType === "Path" ||
            lastSelected.toolType === "Callout"
        ) {
            applyToLineTool(lastSelected.id, lastSelected.toolType);
        }
        window.setTimeout(() => {
            syncSelectionByIds([lastSelected.id], lastSelected.id);
        }, 0);
    }, [isChartReady, rectangleFillColor, rectangleBorderColor, drawingLineColor, parseDrawingToolExports, syncSelectionByIds]);

    useEffect(() => {
        if (!isChartReady || !lineToolsRef.current) return;
        refreshVisibleLongShortDrawings();
        scheduleTimeGuideOverlayRefreshRef.current();
    }, [isChartReady, longShortLots, longShortSymbol, refreshVisibleLongShortDrawings]);

    // Handle Delete key to remove selected drawing tools
    useEffect(() => {
        if (!isChartReady || !lineToolsRef.current) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const target = e.target as HTMLElement;
                if (
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable
                ) {
                    return;
                }
                e.preventDefault();
                cancelActiveDrawing();
                clearAllDrawingSelections();
                window.setTimeout(() => {
                    onDrawingToolCancelRef.current?.();
                }, 0);
                return;
            }
            if (e.key === "Delete" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                // Only delete if not typing in an input/textarea
                const target = e.target as HTMLElement;
                if (
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable
                ) {
                    return;
                }
                e.preventDefault();
                deleteSelectedDrawings();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [cancelActiveDrawing, clearAllDrawingSelections, deleteSelectedDrawings, isChartReady]);

    // Keyboard navigation (scroll/zoom) when chart is hovered
    useEffect(() => {
        if (!isChartReady || !isHovered || !chartRef.current) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.isContentEditable
            ) {
                return;
            }

            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return;
            const range = timeScale.getVisibleLogicalRange();
            if (!range) return;

            const span = range.to - range.from;
            if (!Number.isFinite(span) || span <= 0) return;
            const center = (range.from + range.to) / 2;
            const scrollStep = e.shiftKey ? Math.max(20, span * 0.2) : Math.max(5, span * 0.1);

            if (e.key === "ArrowLeft") {
                timeScale.setVisibleLogicalRange({
                    from: range.from - scrollStep,
                    to: range.to - scrollStep,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "ArrowRight") {
                timeScale.setVisibleLogicalRange({
                    from: range.from + scrollStep,
                    to: range.to + scrollStep,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "PageUp") {
                const pageStep = Math.max(20, span * 0.6);
                timeScale.setVisibleLogicalRange({
                    from: range.from - pageStep,
                    to: range.to - pageStep,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "PageDown") {
                const pageStep = Math.max(20, span * 0.6);
                timeScale.setVisibleLogicalRange({
                    from: range.from + pageStep,
                    to: range.to + pageStep,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "+" || e.key === "=") {
                const newSpan = Math.max(5, span * 0.8);
                timeScale.setVisibleLogicalRange({
                    from: center - newSpan / 2,
                    to: center + newSpan / 2,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "-" || e.key === "_") {
                const newSpan = span * 1.25;
                timeScale.setVisibleLogicalRange({
                    from: center - newSpan / 2,
                    to: center + newSpan / 2,
                });
                e.preventDefault();
                return;
            }

            if (e.key === "End" && endKeyScrollTargetTimestamp != null) {
                const visibleRange = timeScale.getVisibleRange();
                const targetSec = endKeyScrollTargetTimestamp / 1000;
                const visibleSpanSeconds = visibleRange
                    ? Math.max(1, (visibleRange.to as number) - (visibleRange.from as number))
                    : null;

                if (visibleSpanSeconds != null && Number.isFinite(visibleSpanSeconds)) {
                    timeScale.setVisibleRange({
                        from: (targetSec - visibleSpanSeconds) as Time,
                        to: targetSec as Time,
                    });
                } else {
                    const halfWindow = span / 2;
                    timeScale.setVisibleRange({
                        from: (targetSec - halfWindow) as Time,
                        to: (targetSec + halfWindow) as Time,
                    });
                }
                e.preventDefault();
                return;
            }

            if (e.key === "0") {
                timeScale.fitContent();
                e.preventDefault();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [endKeyScrollTargetTimestamp, isChartReady, isHovered]);

    useImperativeHandle(ref, () => ({
        fitContent: () => {
            chartRef.current?.timeScale().fitContent();
        },
        setHighlightedTradeId: (tradeId: number | null) => {
            const pluginMap = tradeHistoryPluginMapRef.current;
            for (const [, plugin] of pluginMap) {
                plugin.setSelected(false);
            }
            if (tradeId != null) {
                const plugin = pluginMap.get(tradeId);
                if (plugin) {
                    plugin.setSelected(true);
                }
            }
        },
        scrollToTrade,
        removeAllDrawingTools: () => {
            hiddenDrawingsRef.current = [];
            removeLineToolsByIdSafely(exportCurrentDrawings().map((drawing) => drawing.id));
            clearAllDrawingSelections();
            scheduleTimeGuideOverlayRefreshRef.current();
        },
        deleteSelectedDrawings,
        cancelActiveDrawing,
        exportAllDrawings: () =>
            drawingsHiddenRef.current ? [...hiddenDrawingsRef.current] : exportCurrentDrawings(),
        importDrawings: (drawings: DrawingToolExport[]) => {
            syncImportedDrawings(drawings);
        },
        getViewportCenterTimestamp: (): number | null => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return null;
            const range = timeScale.getVisibleRange();
            if (!range) return null;
            const centerSec = ((range.from as number) + (range.to as number)) / 2;
            return centerSec * 1000;
        },
        getVisibleWindowSeconds: (): number | null => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return null;
            const range = timeScale.getVisibleRange();
            if (!range) return null;
            return Math.max(1, (range.to as number) - (range.from as number));
        },
        getVisibleLogicalRange: (): { from: number; to: number } | null => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return null;
            const range = timeScale.getVisibleLogicalRange();
            if (!range) return null;
            return { from: range.from, to: range.to };
        },
        setVisibleLogicalRange: (range: { from: number; to: number }) => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return;
            timeScale.setVisibleLogicalRange(range);
        },
        scrollToTimestamp: (timestamp: number, windowSeconds?: number) => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return;
            const range = timeScale.getVisibleRange();
            const halfWindow = windowSeconds
                ? windowSeconds / 2
                : range
                    ? ((range.to as number) - (range.from as number)) / 2
                    : 3600;
            const centerSec = timestamp / 1000;
            timeScale.setVisibleRange({
                from: (centerSec - halfWindow) as Time,
                to: (centerSec + halfWindow) as Time,
            });
        },
        getSelectedCalloutConfig,
        updateSelectedCallout,
    }), [
        cancelActiveDrawing,
        clearAllDrawingSelections,
        deleteSelectedDrawings,
        exportCurrentDrawings,
        removeLineToolsByIdSafely,
        scheduleTimeGuideOverlayRefreshRef,
        getSelectedCalloutConfig,
        scrollToTrade,
        syncImportedDrawings,
        updateSelectedCallout,
    ]);

    // Update chart data and auto-scroll to trade
    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !isChartReady || data.length === 0) return;

        const timeScale = chartRef.current?.timeScale();
        const priceScale = series.priceScale();
        const drawingsBeforeDataUpdate =
            drawingToolRef.current == null && getLineToolsInternal()?._interactionManager?._currentToolCreating == null
                ? exportCurrentDrawings()
                : [];
        const previousBars = prevBarsRef.current;
        if (previousBars.length === 0 || dataUpdateMode === "replace") {
            priceScale.setAutoScale(true);
        }
        const currentRange = !autoScrollOnData && timeScale ? timeScale.getVisibleLogicalRange() : null;
        const hasReplayFutureSpace = replayFutureTimestamps.length > 0;
        const appendOnlyUpdate =
            !autoScrollOnData &&
            !hasReplayFutureSpace &&
            (dataUpdateMode === "append" ||
                (dataUpdateMode === "auto" && isAppendOnlyUpdate(previousBars, data)));
        const lastBarMutationUpdate =
            !autoScrollOnData &&
            !hasReplayFutureSpace &&
            dataUpdateMode === "append" &&
            isLastBarMutationUpdate(previousBars, data);
        const prependedBarCount =
            !autoScrollOnData
                ? dataUpdateMode === "prepend"
                    ? Math.max(0, data.length - previousBars.length)
                    : dataUpdateMode === "auto"
                        ? getPrependedBarCount(previousBars, data)
                        : 0
                : 0;
        const shouldPreserveReplayViewportExactly =
            !autoScrollOnData &&
            hasReplayFutureSpace &&
            currentRange != null &&
            previousBars.length > 0 &&
            prependedBarCount === 0;

        if (appendOnlyUpdate) {
            const appendedBars = data.slice(previousBars.length);
            const applyFullDataFallback = () => {
                const formattedData = formatData(data);
                series.setData(formattedData);
                if (timeScale && currentRange && previousBars.length > 0) {
                    suppressVisibleRangeUntilRef.current = Date.now() + 60;
                    timeScale.setVisibleLogicalRange(currentRange);
                }
            };
            try {
                if (appendedBars.length === 0 && lastBarMutationUpdate) {
                    const nextLastBar = data[data.length - 1];
                    series.update(toCandlestickPoint(nextLastBar));
                } else if (appendedBars.length <= 50) {
                    // Small appends: incremental updates (fast, flicker-free)
                    for (const bar of appendedBars) {
                        series.update(toCandlestickPoint(bar));
                    }
                } else {
                // Large appends: bulk setData (avoids main-thread freeze from 4000+ update calls)
                const formattedData = formatData(data);
                series.setData(formattedData);
                // Restore viewport SYNCHRONOUSLY to prevent flicker —
                // the browser hasn't painted yet, so there's no visible flash
                if (timeScale && currentRange && previousBars.length > 0) {
                    suppressVisibleRangeUntilRef.current = Date.now() + 60;
                    timeScale.setVisibleLogicalRange(currentRange);
                }
                }
            } catch {
                applyFullDataFallback();
            }
        } else {
            // Remove existing drawings before data replacement to prevent
            // the line tools plugin from corrupting its internal bar-index
            // mapping when the entire series is swapped (e.g. M1 → M15).
            if (drawingsBeforeDataUpdate.length > 0) {
                removeLineToolsByIdSafely(drawingsBeforeDataUpdate.map((d) => d.id));
            }
            const formattedData = formatData(data);
            series.setData(formattedData);
        }

        if (!autoScrollOnData) {
            if (timeScale && currentRange && previousBars.length > 0) {
                if (appendOnlyUpdate) {
                    // Small appends already handled above; large appends already restored viewport.
                    // Just suppress edge callbacks briefly for stability.
                    suppressVisibleRangeUntilRef.current = Math.max(
                        suppressVisibleRangeUntilRef.current,
                        Date.now() + 30
                    );
                } else if (shouldPreserveReplayViewportExactly) {
                    // During replay we replace future whitespace with real candles.
                    // Keeping the exact logical range prevents the viewport from snapping back
                    // when playback advances or live ticks mutate the latest replayed bar.
                    suppressVisibleRangeUntilRef.current = Date.now() + 60;
                    timeScale.setVisibleLogicalRange(currentRange);
                } else if (prependedBarCount > 0) {
                    suppressVisibleRangeUntilRef.current = Date.now() + 60;
                    timeScale.setVisibleLogicalRange({
                        from: currentRange.from + prependedBarCount,
                        to: currentRange.to + prependedBarCount,
                    });
                } else {
                    const newIndexByTimestamp = new Map<number, number>();
                    for (let i = 0; i < data.length; i += 1) {
                        newIndexByTimestamp.set(data[i].timestamp, i);
                    }

                    const centerLogical = (currentRange.from + currentRange.to) / 2;
                    const anchorOldIndex = Math.max(0, Math.min(previousBars.length - 1, Math.round(centerLogical)));
                    const anchorTimestamp = previousBars[anchorOldIndex]?.timestamp;
                    if (anchorTimestamp != null) {
                        const anchorNewIndex =
                            newIndexByTimestamp.get(anchorTimestamp) ?? findNearestIndexByTimestamp(data, anchorTimestamp);
                        const delta = anchorNewIndex - anchorOldIndex;
                        if (Math.abs(delta) < data.length) {
                            suppressVisibleRangeUntilRef.current = Date.now() + 60;
                            timeScale.setVisibleLogicalRange({
                                from: currentRange.from + delta,
                                to: currentRange.to + delta,
                            });
                        }
                    } else {
                        suppressVisibleRangeUntilRef.current = Date.now() + 60;
                        timeScale.setVisibleLogicalRange(currentRange);
                    }
                }
            }
            scheduleFreePriceScaleMode();
            if (drawingsBeforeDataUpdate.length > 0 && !appendOnlyUpdate) {
                window.setTimeout(() => {
                    syncImportedDrawings(drawingsBeforeDataUpdate);
                }, 0);
            }
            prevBarsRef.current = data;
            return;
        }

        scheduleFreePriceScaleMode();
        if (drawingsBeforeDataUpdate.length > 0 && !appendOnlyUpdate) {
            window.setTimeout(() => {
                syncImportedDrawings(drawingsBeforeDataUpdate);
            }, 0);
        }
        prevBarsRef.current = data;
    }, [data, isChartReady, formatData, replayFutureTimestamps, autoScrollOnData, dataUpdateMode, exportCurrentDrawings, findNearestIndexByTimestamp, getLineToolsInternal, getPrependedBarCount, isAppendOnlyUpdate, isLastBarMutationUpdate, removeLineToolsByIdSafely, scheduleFreePriceScaleMode, syncImportedDrawings, toCandlestickPoint]);

    useEffect(() => {
        if (!autoScrollOnData || !isChartReady || data.length === 0) return;

        const timer = window.setTimeout(() => {
            suppressVisibleRangeUntilRef.current = Date.now() + 120;
            if (trade) {
                scrollToTrade(zoomOutMultiplier);
            } else {
                chartRef.current?.timeScale().fitContent();
            }
        }, trade ? 50 : 0);

        return () => window.clearTimeout(timer);
    }, [autoScrollOnData, data, isChartReady, scrollToTrade, trade, zoomOutMultiplier]);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !isChartReady || !tradeHistory || tradeHistory.length === 0 || data.length === 0) {
            clearTradeHistoryPlugins(series);
            return;
        }

        clearTradeHistoryPlugins(series);

        const attachedPlugins = tradeHistory
            .map((historyTrade) => {
                const overlay = buildTradeOverlay(historyTrade, data, true);
                return overlay ? { overlay, tradeId: historyTrade.id } : null;
            })
            .filter((entry): entry is { overlay: TradeOverlayData; tradeId: number | undefined } => entry !== null)
            .map(({ overlay, tradeId }) => {
                const plugin = new RiskRewardPlugin(
                    overlay.entryPrice,
                    overlay.scaledRiskPrice,
                    overlay.rewardPrice,
                    overlay.startTs,
                    overlay.endTs,
                    overlay.isBuy,
                    overlay.useMae,
                    overlay.labels
                );
                series.attachPrimitive(plugin);
                if (tradeId != null) {
                    tradeHistoryPluginMapRef.current.set(tradeId, plugin);
                }
                return plugin;
            });

        tradeHistoryPluginsRef.current = attachedPlugins;

        const selectedId = selectedTradeHistoryIdRef.current;
        if (selectedId != null) {
            const plugin = tradeHistoryPluginMapRef.current.get(selectedId);
            if (plugin) {
                plugin.setSelected(true);
            }
        }

        return () => {
            for (const plugin of attachedPlugins) {
                try {
                    series.detachPrimitive(plugin);
                } catch {
                    // Ignore detach errors when chart state changes rapidly.
                }
            }

            if (tradeHistoryPluginsRef.current === attachedPlugins) {
                tradeHistoryPluginsRef.current = [];
            }
        };
    }, [clearTradeHistoryPlugins, data, isChartReady, tradeHistory]);

    useEffect(() => {
        const pluginMap = tradeHistoryPluginMapRef.current;
        if (pluginMap.size === 0) return;

        for (const [, plugin] of pluginMap) {
            plugin.setSelected(false);
        }

        if (selectedTradeHistoryId != null) {
            const plugin = pluginMap.get(selectedTradeHistoryId);
            if (plugin) {
                plugin.setSelected(true);
            }
        }
    }, [selectedTradeHistoryId]);

    // Manage R:R Visualization (Plugin + Price Lines) with Adaptive Scaling
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || !trade || data.length === 0 || !showRiskReward) {
            // Remove plugin if hidden
            if (riskRewardPluginRef.current && seriesRef.current) {
                seriesRef.current.detachPrimitive(riskRewardPluginRef.current);
                riskRewardPluginRef.current = null;
            }
            return;
        }

        const series = seriesRef.current;
        const isBuy = trade.direction === Direction.Buy;
        const symbol = trade.symbol ?? "";

        // Raw prices (for pips labels - use unscaled)
        const rawEntry = trade.entryPrice ?? trade.openPrice;
        const rawReward = trade.closePrice ?? trade.takeProfit;
        const rawStopLoss = trade.stopLoss;

        let entryPrice = rawEntry;
        let rewardPrice = rawReward;
        let stopLoss = rawStopLoss;

        // --- Compute MAE (Maximum Adverse Excursion): lowest low (Buy) or highest high (Sell) from open onward ---
        const openTs = new Date(trade.openTime).getTime();
        const closeTs = trade.closeTime ? new Date(trade.closeTime).getTime() : null;
        const dataEndTs = data.length > 0 ? Math.max(...data.map((b) => b.timestamp)) : openTs;
        const endTs = closeTs ?? dataEndTs;
        const tradeBars = data.filter((b) => b.timestamp >= openTs && b.timestamp <= endTs);
        const allBarsFromOpen = data.filter((b) => b.timestamp >= openTs);

        let rawMaePrice: number | null = null;
        const barsForMae = tradeBars.length > 0 ? tradeBars : allBarsFromOpen;
        if (barsForMae.length > 0) {
            rawMaePrice = isBuy
                ? Math.min(...barsForMae.map((b) => b.low))
                : Math.max(...barsForMae.map((b) => b.high));
        }

        // Check if trade is closed with actual profit/loss
        const actualProfit = trade.netProfit ?? trade.grossProfit;
        const isClosedTrade = trade.closeTime != null && actualProfit != null && Number.isFinite(actualProfit);
        const isWinningTrade = isClosedTrade && (actualProfit ?? 0) > 0;

        // Risk zone: use explicit SL when present, otherwise use MAE (Maximum Adverse Excursion).
        // Show MAE only for winning trades (or open trades); for losing closed trades without SL, hide MAE entirely.
        const hasExplicitSL = stopLoss != null && Number.isFinite(stopLoss);
        const hasMae = rawMaePrice != null && Number.isFinite(rawMaePrice);
        const useMae = hasMae && !hasExplicitSL && (!isClosedTrade || isWinningTrade);
        const showRiskZone = hasExplicitSL || useMae;
        const maePrice = rawMaePrice;

        // --- ADAPTIVE SCALING LOGIC (Robust Power of 10) ---
        const avgPrice = data.reduce((sum, bar) => sum + bar.close, 0) / data.length;

        if (entryPrice && avgPrice > 0) {
            const ratio = avgPrice / entryPrice;
            const logDiff = Math.log10(ratio);
            const magnitude = Math.round(logDiff);

            if (Math.abs(magnitude) >= 1) {
                const multiplier = Math.pow(10, magnitude);
                entryPrice = entryPrice * multiplier;
                if (rewardPrice) rewardPrice = rewardPrice * multiplier;
                if (stopLoss != null) stopLoss = stopLoss * multiplier;
                // Do NOT scale maePrice - it comes from bars, already in chart scale

                
            }
        }

        // Risk price: SL/MAE. MAE from bars is in chart scale; when trade was scaled, maePrice needs same scale as entry for comparison.
        // For trades where we don't want a visible risk zone, fall back to entryPrice so the rectangle collapses.
        const scaledRiskPrice =
            hasExplicitSL && stopLoss != null
                ? stopLoss
                : useMae && maePrice != null
                    ? maePrice
                    : entryPrice;

        // -----------------------------

        // 1. Manage Price Lines (Labels Only - Line Hidden)
        if (entryLineRef.current) { series.removePriceLine(entryLineRef.current); entryLineRef.current = null; }
        if (stopLossLineRef.current) { series.removePriceLine(stopLossLineRef.current); stopLossLineRef.current = null; }
        if (exitLineRef.current) { series.removePriceLine(exitLineRef.current); exitLineRef.current = null; }

        // Price lines: show price on axis only, no "ENTRY"/"EXIT" labels
        if (entryPrice != null && Number.isFinite(entryPrice)) {
            entryLineRef.current = series.createPriceLine({
                price: entryPrice,
                color: "#6b7280",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                lineVisible: false,
                title: "",
            });
        }

        if (showRiskZone && scaledRiskPrice != null && Number.isFinite(scaledRiskPrice)) {
            stopLossLineRef.current = series.createPriceLine({
                price: scaledRiskPrice,
                color: "#6b7280",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                lineVisible: false,
                title: "",
            });
        }

        if (rewardPrice != null && Number.isFinite(rewardPrice)) {
            exitLineRef.current = series.createPriceLine({
                price: rewardPrice,
                color: "#6b7280",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                lineVisible: false,
                title: "",
            });
        }

        // 2. Build RR labels as dollar amounts (e.g. "-$3.00", "+$6.85")
        const lots = (trade.lots ?? volumeToLots(trade.volume ?? 0, symbol)) || 0.01;
        const direction = isBuy ? "Buy" : "Sell";
        const rawRiskPrice = hasExplicitSL
            ? rawStopLoss
            : useMae
                ? rawMaePrice
                : null;

        let riskLabel: string | undefined;
        // Show risk label for:
        // - trades with explicit SL (both wins and losses), or
        // - MAE-based risk only when allowed by useMae (winning or open trades)
        if (showRiskRewardLabels && showRiskZone && rawEntry != null && rawRiskPrice != null) {
            const riskDollar = estimateGrossProfit(rawEntry, rawRiskPrice, lots, direction, symbol);
            if (Number.isFinite(riskDollar) && Math.abs(riskDollar) < 1_000_000) {
                const sign = riskDollar >= 0 ? "+" : "";
                riskLabel = `${sign}$${riskDollar.toFixed(2)}`;
            }
        }

        let rewardLabel: string | undefined;
        if (!showRiskRewardLabels) {
            rewardLabel = undefined;
        } else if (actualProfit != null && Number.isFinite(actualProfit) && Math.abs(actualProfit) < 1_000_000) {
            const sign = actualProfit >= 0 ? "+" : "";
            rewardLabel = `${sign}$${actualProfit.toFixed(2)}`;
        } else if (rawEntry != null && rawReward != null) {
            const rewardDollar = estimateGrossProfit(rawEntry, rawReward, lots, direction, symbol);
            if (Number.isFinite(rewardDollar) && Math.abs(rewardDollar) < 1_000_000) {
                const sign = rewardDollar >= 0 ? "+" : "";
                rewardLabel = `${sign}$${rewardDollar.toFixed(2)}`;
            }
        }

        const netProfit = trade.netProfit ?? trade.grossProfit;
        const profitLabel =
            showRiskRewardLabels && netProfit != null && Number.isFinite(netProfit)
                ? `${netProfit >= 0 ? "+" : ""}$${netProfit.toFixed(2)}`
                : undefined;

        // 3. Manage RiskRewardPlugin (attach/update or detach)
        if (entryPrice != null && scaledRiskPrice != null && rewardPrice != null && data.length > 0) {
            const findClosestTime = (targetDate: Date | string | number): Time => {
                const targetTs = new Date(targetDate).getTime();
                const closest = data.reduce((prev, curr) =>
                    Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev
                );
                return (closest.timestamp / 1000) as Time;
            };

            const startTs = findClosestTime(trade.openTime);
            let endTs: Time | null = null;
            if (trade.closeTime) {
                endTs = findClosestTime(trade.closeTime);
            }

            const isProfit = (trade.netProfit ?? trade.grossProfit ?? 0) >= 0;
        const labels = { riskLabel, rewardLabel, profitLabel, isProfit };

            if (!riskRewardPluginRef.current) {
                const plugin = new RiskRewardPlugin(
                    entryPrice,
                    scaledRiskPrice,
                    rewardPrice,
                    startTs,
                    endTs,
                    isBuy,
                    useMae,
                    labels
                );
                series.attachPrimitive(plugin);
                riskRewardPluginRef.current = plugin;
            } else {
                riskRewardPluginRef.current.updateData(
                    entryPrice,
                    scaledRiskPrice,
                    rewardPrice,
                    startTs,
                    endTs,
                    isBuy,
                    useMae,
                    labels
                );
            }
        } else if (riskRewardPluginRef.current) {
            series.detachPrimitive(riskRewardPluginRef.current);
            riskRewardPluginRef.current = null;
        }
    }, [data, isChartReady, trade, showRiskReward, showRiskRewardLabels]);

    useEffect(() => {
        const series = seriesRef.current;
        if (!series || !isChartReady) return;

        if (liveBidLineRef.current) {
            series.removePriceLine(liveBidLineRef.current);
            liveBidLineRef.current = null;
        }
        if (liveAskLineRef.current) {
            series.removePriceLine(liveAskLineRef.current);
            liveAskLineRef.current = null;
        }

        if (liveBidPrice != null && Number.isFinite(liveBidPrice)) {
            liveBidLineRef.current = series.createPriceLine({
                price: liveBidPrice,
                color: "rgba(148, 163, 184, 0.55)",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
                lineVisible: true,
                title: "",
            });
        }

        if (liveAskPrice != null && Number.isFinite(liveAskPrice)) {
            liveAskLineRef.current = series.createPriceLine({
                price: liveAskPrice,
                color: "rgba(239, 68, 68, 0.9)",
                lineWidth: 1,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: false,
                lineVisible: true,
                title: "",
            });
        }

        return () => {
            if (!seriesRef.current) return;
            if (liveBidLineRef.current) {
                seriesRef.current.removePriceLine(liveBidLineRef.current);
                liveBidLineRef.current = null;
            }
            if (liveAskLineRef.current) {
                seriesRef.current.removePriceLine(liveAskLineRef.current);
                liveAskLineRef.current = null;
            }
        };
    }, [isChartReady, liveAskPrice, liveBidPrice]);

    const handleLiveTradeBadgeDragStart = useCallback((
        event: ReactPointerEvent<HTMLButtonElement>,
        toolId: string
    ) => {
        event.preventDefault();
        event.stopPropagation();

        const existingTool = readDrawingToolById(toolId);
        const nextPrice =
            existingTool?.points?.[0]?.price ??
            liveTradePreviewPricesRef.current[toolId] ??
            liveTradeLineSpecsRef.current.get(toolId)?.price;
        if (Number.isFinite(nextPrice)) {
            applyLiveTradePreviewPrice(toolId, nextPrice);
        }
        setLiveTradeDragSession({ toolId });
    }, [applyLiveTradePreviewPrice, readDrawingToolById]);

    const handleLiveTradeActionClick = useCallback((
        event: ReactMouseEvent<HTMLButtonElement>,
        item: LiveTradeOverlayItem
    ) => {
        event.preventDefault();
        event.stopPropagation();

        if (item.positionId && item.lineType === "position-tp") {
            const position = activeLivePositionsRef.current.find((candidate) => candidate.positionId === item.positionId);
            void onActiveLivePositionChangeRef.current?.(
                item.positionId,
                position?.stopLoss ?? null,
                null
            );
            return;
        }

        if (item.positionId && item.lineType === "position-sl") {
            const position = activeLivePositionsRef.current.find((candidate) => candidate.positionId === item.positionId);
            void onActiveLivePositionChangeRef.current?.(
                item.positionId,
                null,
                position?.takeProfit ?? null
            );
            return;
        }

        if (item.positionId && item.lineType === "position-entry") {
            void onActiveLivePositionCloseRef.current?.(item.positionId);
            return;
        }

        if (item.orderId && item.lineType === "order-tp") {
            const order = activeLiveOrdersRef.current.find((candidate) => candidate.orderId === item.orderId);
            void onActiveLiveOrderChangeRef.current?.(item.orderId, {
                stopLoss: order?.stopLoss ?? null,
                takeProfit: null,
            });
            return;
        }

        if (item.orderId && item.lineType === "order-sl") {
            const order = activeLiveOrdersRef.current.find((candidate) => candidate.orderId === item.orderId);
            void onActiveLiveOrderChangeRef.current?.(item.orderId, {
                stopLoss: null,
                takeProfit: order?.takeProfit ?? null,
            });
            return;
        }

        if (item.orderId && item.lineType === "order-entry") {
            void onActiveLiveOrderCancelRef.current?.(item.orderId);
            return;
        }

        if (item.alertId && item.lineType === "alert-target") {
            void onActivePriceAlertDeleteRef.current?.(item.alertId);
        }
    }, []);

    const handleCrosshairQuickActionToggle = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsCrosshairQuickMenuOpen((current) => !current);
    }, []);

    const handleCrosshairQuickAlertCreate = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!crosshairQuickAction) {
            return;
        }
        onCrosshairQuickAlertCreateRef.current?.(crosshairQuickAction.price);
        setIsCrosshairQuickMenuOpen(false);
    }, [crosshairQuickAction]);

    const handleCrosshairQuickOrderCreate = useCallback((
        event: ReactMouseEvent<HTMLButtonElement>,
        side: CrosshairQuickOrderSide,
        orderType: CrosshairQuickOrderType
    ) => {
        event.preventDefault();
        event.stopPropagation();
        if (!crosshairQuickAction) {
            return;
        }
        onCrosshairQuickOrderCreateRef.current?.(side, orderType, crosshairQuickAction.price);
        setIsCrosshairQuickMenuOpen(false);
    }, [crosshairQuickAction]);

    return (
        <div
            className="relative w-full"
            style={{ height }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                clearCrosshairQuickAction();
                setIsCrosshairQuickMenuOpen(false);
            }}
        >
            {/* Loading overlay */}
            {isLoading && data.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-900/50">
                    <div className="flex items-center gap-2 text-gray-400">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
                        <span>Loading chart data...</span>
                    </div>
                </div>
            )}

            {/* Empty state */}
            {!isLoading && data.length === 0 && (
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                    <p className="text-gray-500">No chart data available</p>
                </div>
            )}

            {/* Chart container */}
            <div
                ref={containerRef}
                className="chart-crosshair-lock w-full rounded-lg bg-gray-900/50"
                style={{ height, touchAction: "none" }}
            />

            {liveTradeOverlayItems.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden rounded-lg">
                    {liveTradeOverlayItems.map((item) => {
                        const isEntry = item.lineType === "position-entry" || item.lineType === "order-entry";
                        const isSlTp = !isEntry;
                        const canDragWholeBadge = isSlTp && item.draggable && Boolean(item.dragToolId);
                        const borderColor = withColorAlpha(item.color, 0.95);
                        const chipBg = withColorAlpha(item.color, 1);
                        const chipFg = "rgba(248, 250, 252, 0.98)";
                        const actionBg = withColorAlpha(item.color, 0.9);
                        const pnlBg = item.pnlPositive ? "rgba(6, 95, 70, 1)" : "rgba(127, 29, 29, 1)";
                        const pnlFg = item.pnlPositive ? "rgba(236, 253, 245, 0.98)" : "rgba(254, 242, 242, 0.98)";
                        const pipsBg =
                            item.pipsPositive == null
                                ? "rgba(30, 41, 59, 1)"
                                : item.pipsPositive
                                    ? "rgba(6, 95, 70, 1)"
                                    : "rgba(127, 29, 29, 1)";
                        const pipsFg =
                            item.pipsPositive == null
                                ? "rgba(226, 232, 240, 0.98)"
                                : item.pipsPositive
                                    ? "rgba(236, 253, 245, 0.98)"
                                    : "rgba(254, 242, 242, 0.98)";
                        const currentPnlBg =
                            item.currentPnlPositive == null
                                ? "rgba(30, 41, 59, 1)"
                                : item.currentPnlPositive
                                    ? "rgba(6, 95, 70, 1)"
                                    : "rgba(127, 29, 29, 1)";
                        const currentPnlFg =
                            item.currentPnlPositive == null
                                ? "rgba(226, 232, 240, 0.98)"
                                : item.currentPnlPositive
                                    ? "rgba(236, 253, 245, 0.98)"
                                    : "rgba(254, 242, 242, 0.98)";

                        return (
                            <div
                                key={item.id}
                                className={`absolute z-[2] flex -translate-y-1/2 items-center ${canDragWholeBadge ? "pointer-events-auto cursor-ns-resize" : ""}`}
                                style={{ top: `${item.y}px`, right: `${liveTradeOverlayPadRight}px` }}
                                onPointerDown={
                                    canDragWholeBadge
                                        ? (e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleLiveTradeBadgeDragStart(
                                                e as unknown as ReactPointerEvent<HTMLButtonElement>,
                                                item.dragToolId!
                                            );
                                        }
                                        : undefined
                                }
                            >
                                {/* Invisible full-width drag strip for line-level dragging */}
                                {item.draggable && item.dragToolId && (
                                    <div
                                        className="pointer-events-auto absolute right-0 cursor-ns-resize"
                                        style={{ top: "-9px", height: "18px", left: "-3000px" }}
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleLiveTradeBadgeDragStart(e as unknown as ReactPointerEvent<HTMLButtonElement>, item.dragToolId!);
                                        }}
                                    />
                                )}

                                {/* TP toggle — entry lines only */}
                                {isEntry && item.showTpToggle && item.tpDragToolId && (
                                    <button
                                        type="button"
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleLiveTradeBadgeDragStart(e, item.tpDragToolId!);
                                        }}
                                        className={`pointer-events-auto inline-flex h-5 items-center rounded-l border-y border-l px-1.5 text-[10px] font-bold leading-none tracking-wide shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors ${
                                            item.hasTp
                                                ? "cursor-ns-resize border-emerald-500/80 bg-emerald-950 text-emerald-300 hover:bg-emerald-900"
                                                : "cursor-ns-resize border-slate-600/60 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                                        }`}
                                        title="Drag to set take profit"
                                    >
                                        TP
                                    </button>
                                )}

                                {/* SL toggle — entry lines only */}
                                {isEntry && item.showSlToggle && item.slDragToolId && (
                                    <button
                                        type="button"
                                        onPointerDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleLiveTradeBadgeDragStart(e, item.slDragToolId!);
                                        }}
                                        className={`pointer-events-auto inline-flex h-5 items-center border-y border-l px-1.5 text-[10px] font-bold leading-none tracking-wide shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors ${
                                            item.hasSl
                                                ? "cursor-ns-resize border-red-500/80 bg-red-950 text-red-300 hover:bg-red-900"
                                                : "cursor-ns-resize border-slate-600/60 bg-slate-950 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                                        }`}
                                        title="Drag to set stop loss"
                                    >
                                        SL
                                    </button>
                                )}

                                {item.pipsLabel && (
                                    <span
                                        className="inline-flex h-5 items-center border-y border-l px-1.5 text-[11px] font-semibold leading-none tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                                        style={{
                                            borderColor,
                                            backgroundColor: pipsBg,
                                            color: pipsFg,
                                            ...(isSlTp && !item.showTpToggle ? { borderRadius: "3px 0 0 3px" } : {}),
                                        }}
                                    >
                                        {item.pipsLabel}
                                    </span>
                                )}

                                {isEntry && item.currentPnlLabel && (
                                    <span
                                        className="inline-flex h-5 items-center border-y border-l px-1.5 text-[11px] font-semibold leading-none tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                                        style={{
                                            borderColor,
                                            backgroundColor: currentPnlBg,
                                            color: currentPnlFg,
                                        }}
                                    >
                                        {item.currentPnlLabel}
                                    </span>
                                )}

                                {/* Lots badge */}
                                <span
                                    className="inline-flex h-5 items-center border-y border-l px-1.5 text-[11px] font-semibold leading-none tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                                    style={{
                                        borderColor,
                                        backgroundColor: chipBg,
                                        color: chipFg,
                                        ...(isSlTp && !item.showTpToggle && !item.pipsLabel ? { borderRadius: "3px 0 0 3px" } : {}),
                                    }}
                                >
                                    {item.lotsLabel}
                                </span>

                                {/* P&L label — SL/TP lines */}
                                {isSlTp && item.pnlLabel && (
                                    <span
                                        className="inline-flex h-5 items-center border-y border-l px-1.5 text-[11px] font-semibold leading-none tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                                        style={{
                                            borderColor,
                                            backgroundColor: pnlBg,
                                            color: pnlFg,
                                        }}
                                    >
                                        {item.pnlLabel}
                                    </span>
                                )}

                                {/* Main label (order type / direction) — entry lines */}
                                {isEntry && (
                                    item.draggable && item.dragToolId ? (
                                        <button
                                            type="button"
                                            onPointerDown={(e) => handleLiveTradeBadgeDragStart(e, item.dragToolId!)}
                                            className="pointer-events-auto inline-flex h-5 cursor-ns-resize items-center border-y border-l px-2 text-[11px] font-semibold leading-none tracking-[0.01em] shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors hover:brightness-110"
                                            style={{
                                                borderColor,
                                                backgroundColor: chipBg,
                                                color: chipFg,
                                            }}
                                            title="Drag to move this pending order"
                                        >
                                            {item.label}
                                        </button>
                                    ) : (
                                        <span
                                            className="inline-flex h-5 items-center border-y border-l px-2 text-[11px] font-semibold leading-none tracking-[0.01em] shadow-[0_1px_2px_rgba(0,0,0,0.45)]"
                                            style={{
                                                borderColor,
                                                backgroundColor: chipBg,
                                                color: chipFg,
                                            }}
                                        >
                                            {item.label}
                                        </span>
                                    )
                                )}

                                {/* Close / Cancel button */}
                                <button
                                    type="button"
                                    onClick={(e) => handleLiveTradeActionClick(e, item)}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="pointer-events-auto inline-flex h-5 items-center rounded-r border px-1.5 text-[11px] font-bold leading-none text-slate-50 shadow-[0_1px_2px_rgba(0,0,0,0.45)] transition-colors hover:bg-rose-600 hover:text-white"
                                    style={{
                                        borderColor,
                                        backgroundColor: actionBg,
                                        color: chipFg,
                                    }}
                                    title={
                                        item.lineType === "order-entry"
                                            ? "Cancel pending order"
                                            : item.lineType === "position-entry"
                                                ? "Close position"
                                                : item.lineType === "alert-target"
                                                    ? "Delete alert"
                                                : item.lineType.endsWith("-tp")
                                                    ? "Remove take profit"
                                                    : "Remove stop loss"
                                    }
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {canShowCrosshairQuickActions && isHovered && crosshairQuickAction && !isCrosshairQuickActionBlocked && !replayPlacementMode && !liveTradeDragSession && (
                <div
                    ref={crosshairQuickActionRef}
                    className="absolute z-[6] -translate-y-1/2"
                    style={{
                        top: `${crosshairQuickAction.y}px`,
                        right: `${Math.max(4, liveTradeOverlayPadRight)}px`,
                    }}
                >
                    <button
                        type="button"
                        onClick={handleCrosshairQuickActionToggle}
                        className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-500/70 bg-slate-800/95 text-[12px] font-semibold text-slate-50 shadow-lg transition-colors hover:bg-slate-700"
                        title="Crosshair actions"
                    >
                        +
                    </button>

                    {isCrosshairQuickMenuOpen && crosshairQuickPriceLabel && (
                        <div className="absolute right-7 top-1/2 w-[280px] -translate-y-1/2 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-2xl backdrop-blur">
                            <div className="border-b border-border/80 px-3 py-2">
                                <button
                                    type="button"
                                    onClick={handleCrosshairQuickAlertCreate}
                                    className="flex w-full items-center justify-between gap-3 text-left text-sm text-foreground transition-colors hover:text-primary"
                                >
                                    <span>Add alert on {(longShortSymbolRef.current ?? "symbol").toUpperCase()} at {crosshairQuickPriceLabel}</span>
                                    <span className="text-[11px] text-muted-foreground">Alert</span>
                                </button>
                            </div>
                            {onCrosshairQuickOrderCreate && (
                                <>
                                    <div className="border-b border-border/80 px-3 py-2">
                                        <button
                                            type="button"
                                            onClick={(event) => handleCrosshairQuickOrderCreate(event, "SELL", crosshairSellOrderType)}
                                            className="flex w-full items-center justify-between gap-3 text-left text-sm text-foreground transition-colors hover:text-rose-300"
                                        >
                                            <span>
                                                Sell {formatLiveTradeLotsLabel(longShortLotsRef.current)} {(longShortSymbolRef.current ?? "symbol").toUpperCase()} @ {crosshairQuickPriceLabel} {crosshairSellOrderType.toLowerCase()}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">Sell</span>
                                        </button>
                                    </div>
                                    <div className="px-3 py-2">
                                        <button
                                            type="button"
                                            onClick={(event) => handleCrosshairQuickOrderCreate(event, "BUY", crosshairBuyOrderType)}
                                            className="flex w-full items-center justify-between gap-3 text-left text-sm text-foreground transition-colors hover:text-emerald-300"
                                        >
                                            <span>
                                                Buy {formatLiveTradeLotsLabel(longShortLotsRef.current)} {(longShortSymbolRef.current ?? "symbol").toUpperCase()} @ {crosshairQuickPriceLabel} {crosshairBuyOrderType.toLowerCase()}
                                            </span>
                                            <span className="text-[11px] text-muted-foreground">Buy</span>
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}

            {useCustomLivePriceStack && candleCountdownOverlay.top != null && (
                <div
                    className="pointer-events-none absolute right-0 z-[4]"
                    style={{
                        top: `${candleCountdownOverlay.top}px`,
                        width: `${candleCountdownLabelWidth}px`,
                    }}
                >
                    <div className="border border-slate-500/35 bg-slate-700/95 px-1 py-0 text-center text-[11px] font-medium leading-[1.05] tabular-nums text-slate-50 shadow-sm">
                        {candleCountdownPriceLabel}
                    </div>
                    <div className="border border-t-0 border-slate-500/35 bg-slate-800/95 px-1 py-0 text-center text-[11px] font-medium leading-[1.05] tabular-nums text-slate-100">
                        {candleCountdownLabel}
                    </div>
                </div>
            )}

            {selectionBox && (
                <div className="pointer-events-none absolute inset-0 z-[2] overflow-hidden rounded-lg">
                    <div
                        className="absolute border border-sky-400/80 bg-sky-400/10"
                        style={{
                            left: `${selectionBox.left}px`,
                            top: `${selectionBox.top}px`,
                            width: `${selectionBox.width}px`,
                            height: `${selectionBox.height}px`,
                        }}
                    />
                </div>
            )}

            {replayPlacementOverlay.x != null && (
                <div
                    className={`pointer-events-none absolute z-[3] overflow-hidden ${
                        clipTimeGuideOverlayToPane ? "left-0 top-0" : "inset-0 rounded-lg"
                    }`}
                    style={
                        clipTimeGuideOverlayToPane &&
                        replayPlacementOverlay.width != null &&
                        replayPlacementOverlay.height != null
                            ? {
                                width: `${replayPlacementOverlay.width}px`,
                                height: `${replayPlacementOverlay.height}px`,
                            }
                            : undefined
                    }
                >
                    <div
                        className="absolute bottom-0 top-0 bg-sky-400/12"
                        style={{
                            left: `${replayPlacementOverlay.x}px`,
                            width: `calc(100% - ${replayPlacementOverlay.x}px)`,
                        }}
                    />
                    <div
                        className="absolute bottom-0 top-0 w-px bg-sky-400/95"
                        style={{ left: `${replayPlacementOverlay.x}px` }}
                    />
                    <div
                        className="absolute top-2 -translate-x-1/2 rounded bg-sky-500/90 px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ left: `${replayPlacementOverlay.x}px` }}
                    >
                        Replay Start
                    </div>
                </div>
            )}

            {timeGuideOverlay.verticalLines.length > 0 && (
                <div
                    className={`pointer-events-none absolute z-[1] overflow-hidden ${
                        clipTimeGuideOverlayToPane ? "left-0 top-0" : "inset-0 rounded-lg"
                    }`}
                    style={
                        clipTimeGuideOverlayToPane &&
                        timeGuideOverlay.width != null &&
                        timeGuideOverlay.height != null
                            ? {
                                width: `${timeGuideOverlay.width}px`,
                                height: `${timeGuideOverlay.height}px`,
                            }
                            : undefined
                    }
                >
                    {timeGuideOverlay.verticalLines.map((line) => (
                        <div
                            key={line.id}
                            className="absolute bottom-0 top-0"
                            style={{
                                left: `${line.x}px`,
                                borderLeft:
                                    line.kind === "daily"
                                        ? "1px dashed rgba(148, 163, 184, 0.55)"
                                        : line.kind === "marker"
                                            ? "1px dotted rgba(56, 189, 248, 0.9)"
                                            : "1px dashed rgba(250, 204, 21, 0.85)",
                            }}
                        />
                    ))}
                </div>
            )}

            {markerOverlay.x != null && (
                <div
                    className={`pointer-events-none absolute z-[1] overflow-hidden ${
                        clipTimeGuideOverlayToPane ? "left-0 top-0" : "inset-0 rounded-lg"
                    }`}
                    style={
                        clipTimeGuideOverlayToPane &&
                        markerOverlay.width != null &&
                        markerOverlay.height != null
                            ? {
                                width: `${markerOverlay.width}px`,
                                height: `${markerOverlay.height}px`,
                            }
                            : undefined
                    }
                >
                    <div
                        className="absolute bottom-0 top-0"
                        style={{
                            left: `${markerOverlay.x}px`,
                            borderLeft: "1px dotted rgba(56, 189, 248, 0.9)",
                        }}
                    />
                </div>
            )}
        </div>
    );
});

TradeCandlestickChartInner.displayName = "TradeCandlestickChart";

export const TradeCandlestickChart = memo(TradeCandlestickChartInner);
TradeCandlestickChart.displayName = "TradeCandlestickChart";
