"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import {
    createChart,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type CandlestickData,
    type Time,
    ColorType,
    LineStyle,
    CandlestickSeries,
    CrosshairMode,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { estimateGrossProfit, volumeToLots, priceDiffToPips } from "@lib/pnl-estimate";
import { RiskRewardPlugin } from "./plugins/RiskRewardPlugin";
import { createLineToolsPlugin } from "lightweight-charts-line-tools-core";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { registerLinesPlugin } from "lightweight-charts-line-tools-lines";
import { registerPathPlugin } from "lightweight-charts-line-tools-path";
import { registerLongShortPositionPlugin } from "lightweight-charts-line-tools-long-short-position";
import {
    buildTimeGuides,
    type TimeGuideSettings,
} from "./timeGuides";

export type DrawingToolType = "Path" | "TrendLine" | "Rectangle" | "LongShortPosition";
type LineToolsApi = ReturnType<typeof createLineToolsPlugin>;
type DrawingPoint = { timestamp: number; price: number };
type DrawingToolExport = {
    id: string;
    toolType: DrawingToolType;
    points: DrawingPoint[];
    options?: Record<string, unknown>;
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
    };
    requestUpdate?: () => void;
};

function isDrawingToolType(toolType: string): toolType is DrawingToolType {
    return toolType === "Rectangle" || toolType === "TrendLine" || toolType === "Path" || toolType === "LongShortPosition";
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

function sameTimeGuideOverlay(
    left: {
        verticalLines: Array<{ id: string; kind: "daily" | "session"; x: number }>;
    },
    right: {
        verticalLines: Array<{ id: string; kind: "daily" | "session"; x: number }>;
    }
): boolean {
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
    /** Timeframe of the current bar set */
    timeframe?: ChartTimeframe;
    /** Optional time-based guide settings */
    timeGuides?: TimeGuideSettings;
    /** Trade for context visualization */
    trade?: Trade;
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
    /** Line color for Path/TrendLine tools (e.g., rgba or hex) */
    drawingLineColor?: string;
    /** Rectangle tool background color (e.g., rgba or hex) */
    rectangleFillColor?: string;
    /** Rectangle tool border color */
    rectangleBorderColor?: string;
    /** Lot size for Long/Short tool P&L */
    longShortLots?: number;
    /** Symbol for Long/Short tool P&L and pips */
    longShortSymbol?: string;
    /** Notify when a drawing tool is selected */
    onDrawingSelectionChange?: (selectedTool: DrawingToolType | null) => void;
    /** Notify when interactive drawing finishes so parent can exit tool mode */
    onDrawingToolComplete?: (tool: DrawingToolType) => void;
    /** Notify when a rectangle is selected/deselected */
    onRectangleSelectionChange?: (selected: boolean) => void;
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
}

export interface TradeCandlestickChartRef {
    fitContent: () => void;
    scrollToTrade: (zoomOutMultiplier?: number) => void;
    removeAllDrawingTools: () => void;
    exportAllDrawings: () => DrawingToolExport[];
    importDrawings: (drawings: DrawingToolExport[]) => void;
    getViewportCenterTimestamp: () => number | null;
    scrollToTimestamp: (timestamp: number, windowSeconds?: number) => void;
}

/**
 * TradeCandlestickChart - Main candlestick chart component
 *
 * Uses TradingView Lightweight Charts v5 with dark theme (Pure Black),
 * R:R visualization with timestamp snapping for finite boxes.
 */
export const TradeCandlestickChart = forwardRef<TradeCandlestickChartRef, TradeCandlestickChartProps>(function TradeCandlestickChart({
    data,
    timeframe,
    timeGuides,
    trade,
    height = 400,
    onVisibleRangeChange,
    isLoading = false,
    drawingTool = null,
    drawingLineColor,
    rectangleFillColor,
    rectangleBorderColor,
    longShortLots = 1,
    longShortSymbol,
    onDrawingSelectionChange,
    onDrawingToolComplete,
    onRectangleSelectionChange,
    showRiskReward = true,
    showRiskRewardLabels = true,
    autoScrollOnData = true,
    zoomOutMultiplier = 3.2,
    dataUpdateMode = "auto",
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const exitLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const [timeGuideOverlay, setTimeGuideOverlay] = useState<{
        verticalLines: Array<{ id: string; kind: "daily" | "session"; x: number }>;
    }>({
        verticalLines: [],
    });
    const onVisibleRangeChangeRef = useRef<typeof onVisibleRangeChange>(onVisibleRangeChange);
    const onDrawingSelectionChangeRef = useRef<typeof onDrawingSelectionChange>(onDrawingSelectionChange);
    const onDrawingToolCompleteRef = useRef<typeof onDrawingToolComplete>(onDrawingToolComplete);
    const onRectangleSelectionChangeRef = useRef<typeof onRectangleSelectionChange>(onRectangleSelectionChange);
    const prevBarsRef = useRef<ChartBar[]>([]);
    const suppressVisibleRangeUntilRef = useRef(0);

    const riskRewardPluginRef = useRef<RiskRewardPlugin | null>(null);
    const lineToolsRef = useRef<LineToolsApi | null>(null);
    const lastSelectedDrawingRef = useRef<{ id: string; toolType: DrawingToolType } | null>(null);
    const drawingLineColorRef = useRef<string | undefined>(drawingLineColor);
    const rectangleFillColorRef = useRef<string | undefined>(rectangleFillColor);
    const rectangleBorderColorRef = useRef<string | undefined>(rectangleBorderColor);
    const longShortLotsRef = useRef<number>(longShortLots);
    const longShortSymbolRef = useRef<string | undefined>(longShortSymbol);
    const heightRef = useRef<number>(height);
    const overlayFrameRef = useRef<number | null>(null);
    const scheduleTimeGuideOverlayRefreshRef = useRef<() => void>(() => {});
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
        ctrlOrMeta: boolean;
        selectedIds: string[];
    } | null>(null);

    useEffect(() => {
        drawingLineColorRef.current = drawingLineColor;
        rectangleFillColorRef.current = rectangleFillColor;
        rectangleBorderColorRef.current = rectangleBorderColor;
    }, [drawingLineColor, rectangleFillColor, rectangleBorderColor]);

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

    const computedTimeGuides = useMemo(
        () => buildTimeGuides(data, timeframe, timeGuides),
        [data, timeframe, timeGuides]
    );

    const refreshTimeGuideOverlay = useCallback(() => {
        const chart = chartRef.current;

        if (!chart) {
            setTimeGuideOverlay((current) =>
                current.verticalLines.length === 0
                    ? current
                    : { verticalLines: [] }
            );
            return;
        }

        if (computedTimeGuides.verticalLines.length === 0) {
            setTimeGuideOverlay((current) =>
                current.verticalLines.length === 0
                    ? current
                    : { verticalLines: [] }
            );
            return;
        }

        const timeScale = chart.timeScale();
        const nextVerticalLines: Array<{ id: string; kind: "daily" | "session"; x: number }> = [];

        for (const line of computedTimeGuides.verticalLines) {
            const x = timeScale.timeToCoordinate((line.timestamp / 1000) as Time);
            if (x == null || !Number.isFinite(x)) continue;
            nextVerticalLines.push({
                id: line.id,
                kind: line.kind,
                x,
            });
        }

        const nextOverlay = {
            verticalLines: nextVerticalLines,
        };

        setTimeGuideOverlay((current) =>
            sameTimeGuideOverlay(current, nextOverlay) ? current : nextOverlay
        );
    }, [computedTimeGuides]);

    const scheduleTimeGuideOverlayRefresh = useCallback(() => {
        if (overlayFrameRef.current != null) {
            cancelAnimationFrame(overlayFrameRef.current);
        }
        overlayFrameRef.current = requestAnimationFrame(() => {
            overlayFrameRef.current = null;
            refreshTimeGuideOverlay();
        });
    }, [refreshTimeGuideOverlay]);

    useEffect(() => {
        scheduleTimeGuideOverlayRefreshRef.current = scheduleTimeGuideOverlayRefresh;
    }, [scheduleTimeGuideOverlayRefresh]);

    const formatMoney = (value: number) => {
        const sign = value >= 0 ? "+" : "-";
        return `${sign}$${Math.abs(value).toFixed(2)}`;
    };

    const formatPips = (value: number) => {
        const rounded = Math.round(value * 10) / 10;
        const sign = rounded >= 0 ? "+" : "";
        return `${sign}${rounded}p`;
    };

    const updateLongShortText = useCallback((tool: { id: string; points: Array<{ price: number }> }) => {
        if (!lineToolsRef.current) return;
        const symbol = longShortSymbolRef.current ?? "";
        const lots = longShortLotsRef.current;
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

        const baseTextStyle = {
            alignment: "left",
            forceTextAlign: true,
            padding: 2,
            font: {
                color: "rgba(255,255,255,0.92)",
                size: 13,
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

        lineToolsRef.current.applyLineToolOptions({
            id: tool.id,
            toolType: "LongShortPosition",
            options: {
                showAutoText: true,
                entryStopLossText: { ...baseTextStyle, value: riskText },
                entryPtText: { ...rewardBox, value: rewardText },
            },
        } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
    }, []);

    useEffect(() => {
        onDrawingSelectionChangeRef.current = onDrawingSelectionChange;
    }, [onDrawingSelectionChange]);

    useEffect(() => {
        onDrawingToolCompleteRef.current = onDrawingToolComplete;
    }, [onDrawingToolComplete]);

    useEffect(() => {
        onRectangleSelectionChangeRef.current = onRectangleSelectionChange;
    }, [onRectangleSelectionChange]);

    const getLineToolsInternal = useCallback(() => lineToolsRef.current as LineToolsInternalApi | null, []);

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

    const commitSelectionState = useCallback((selectedTools: DrawingToolExport[]) => {
        selectedDrawingIdsRef.current = selectedTools.map((tool) => tool.id);
        if (selectedTools.length === 0) {
            lastSelectedDrawingRef.current = null;
            onDrawingSelectionChangeRef.current?.(null);
            onRectangleSelectionChangeRef.current?.(false);
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

    const duplicateDrawings = useCallback((toolsToDuplicate: DrawingToolExport[], offset?: { timestamp: number; price: number }) => {
        if (toolsToDuplicate.length === 0) return [];
        const duplicatedIds: string[] = [];

        for (const tool of toolsToDuplicate) {
            const duplicatedId = lineToolsRef.current?.addLineTool(
                tool.toolType,
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

    const queueSelectionUpdate = useCallback(() => {
        window.setTimeout(() => updateDrawingSelection(), 0);
        window.setTimeout(() => updateDrawingSelection(), 50);
    }, [updateDrawingSelection]);

    useEffect(() => {
        onVisibleRangeChangeRef.current = onVisibleRangeChange;
    }, [onVisibleRangeChange]);

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
    const formatData = useCallback((bars: ChartBar[]): CandlestickData<Time>[] => {
        return bars.map(toCandlestickPoint);
    }, [toCandlestickPoint]);

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
        });

        chartRef.current = chart;
        seriesRef.current = series;

        const lineTools = createLineToolsPlugin(chart, series);
        lineTools.registerLineTool("Rectangle", LineToolRectangle);
        registerLinesPlugin(lineTools as Parameters<typeof registerLinesPlugin>[0]);
        registerPathPlugin(lineTools as Parameters<typeof registerPathPlugin>[0]);
        registerLongShortPositionPlugin(lineTools as Parameters<typeof registerLongShortPositionPlugin>[0]);
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
                (toolType === "TrendLine" && params.stage === "lineToolFinished") ||
                (toolType === "Path" && (params.stage === "pathFinished" || params.stage === "lineToolFinished"))
            ) {
                const lineColor = drawingLineColorRef.current;
                if (toolId) {
                    lineTools.applyLineToolOptions({
                        id: toolId,
                        toolType,
                        options: {
                            showPriceAxisLabels: false,
                            showTimeAxisLabels: false,
                            ...(lineColor ? { line: { color: lineColor } } : {}),
                        },
                    } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
                }
            }

            if (toolType === "LongShortPosition" && params.selectedLineTool?.points) {
                updateLongShortText({
                    id: params.selectedLineTool.id,
                    points: params.selectedLineTool.points as Array<{ price: number }>,
                });
            }

            if (isFinishedStage) {
                window.setTimeout(() => {
                    if (toolId) {
                        syncSelectionByIds([toolId], toolId);
                    } else {
                        queueSelectionUpdate();
                    }
                    onDrawingToolCompleteRef.current?.(toolType);
                }, 0);
                return;
            }

            queueSelectionUpdate();
        };
        const handleDoubleClick = (params: { selectedLineTool?: { id: string; toolType: string } }) => {
            const rawToolType = params?.selectedLineTool?.toolType;
            if (rawToolType && isDrawingToolType(rawToolType)) {
                const toolType = rawToolType;
                const toolId = params?.selectedLineTool?.id;
                if (toolId) {
                    lastSelectedDrawingRef.current = { id: toolId, toolType };
                }
            }
            queueSelectionUpdate();
        };
        const handleChartClick = () => {
            window.setTimeout(() => {
                const selectedRaw = lineTools.getSelectedLineTools?.();
                if (!selectedRaw) return;
                try {
                    const selectedTools = JSON.parse(selectedRaw) as Array<{ id: string; toolType: string }>;
                    const match = selectedTools.find((tool) =>
                        tool.toolType === "Rectangle" ||
                        tool.toolType === "TrendLine" ||
                        tool.toolType === "Path" ||
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
        lineTools.subscribeLineToolsAfterEdit?.(handleAfterEdit);
        lineTools.subscribeLineToolsDoubleClick?.(handleDoubleClick);
        chart.subscribeClick(handleChartClick);

        const handlePointerDown = (event: PointerEvent) => {
            const point = getChartPointFromClient(event.clientX, event.clientY);
            const hitToolId = point
                ? getLineToolsInternal()?._interactionManager?._hitTest?.(point)?.tool?.id()
                : undefined;

            pointerGestureRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
                button: event.button,
                ctrlOrMeta: event.ctrlKey || event.metaKey,
                selectedIds: [...selectedDrawingIdsRef.current],
            };

            if (!point || event.button !== 0) {
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                queueSelectionUpdate();
                return;
            }

            if ((event.ctrlKey || event.metaKey) && hitToolId && selectedDrawingIdsRef.current.includes(hitToolId)) {
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

            queueSelectionUpdate();
        };
        const handlePointerUp = (event: PointerEvent) => {
            const gesture = pointerGestureRef.current;
            pointerGestureRef.current = null;

            queueSelectionUpdate();

            const point = getChartPointFromClient(event.clientX, event.clientY);
            if (!gesture || !point || gesture.button !== 0) {
                selectionSnapshotRef.current = null;
                duplicateDragPlanRef.current = null;
                return;
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
                const ctrlOrMeta = event.ctrlKey || event.metaKey || gesture.ctrlOrMeta;
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
                    if (selectedDrawingIdsRef.current.length > 1) {
                        syncSelectionByIds([hitToolId], hitToolId);
                    }
                    return;
                }

                clearAllDrawingSelections();
            }, 0);
        };
        chartContainer.addEventListener("pointerdown", handlePointerDown, true);
        chartContainer.addEventListener("pointerup", handlePointerUp, true);

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
            lineToolsRef.current?.removeAllLineTools();
            lineToolsRef.current?.unsubscribeLineToolsAfterEdit?.(handleAfterEdit);
            lineToolsRef.current?.unsubscribeLineToolsDoubleClick?.(handleDoubleClick);
            chart.unsubscribeClick(handleChartClick);
            chartContainer.removeEventListener("pointerdown", handlePointerDown, true);
            chartContainer.removeEventListener("pointerup", handlePointerUp, true);
            lineToolsRef.current = null;
            window.removeEventListener("resize", handleResize);
            window.clearTimeout(timeoutId);
            cancelAnimationFrame(rafId);
            if (overlayFrameRef.current != null) {
                cancelAnimationFrame(overlayFrameRef.current);
                overlayFrameRef.current = null;
            }
            resizeObserver?.disconnect();
            chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRange);
            entryLineRef.current = null;
            stopLossLineRef.current = null;
            exitLineRef.current = null;
            riskRewardPluginRef.current = null;
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            setIsChartReady(false);
        };
    }, [
        clearAllDrawingSelections,
        duplicateDrawings,
        getChartPointFromClient,
        getLineToolsInternal,
        queueSelectionUpdate,
        readDrawingToolById,
        syncSelectionByIds,
        updateLongShortText,
    ]);

    useEffect(() => {
        if (!isChartReady) {
            setTimeGuideOverlay({ verticalLines: [] });
            return;
        }
        scheduleTimeGuideOverlayRefresh();
    }, [isChartReady, scheduleTimeGuideOverlayRefresh, computedTimeGuides, height]);

    useEffect(() => {
        if (!lineToolsRef.current || !drawingTool) return;
        const axisLabelOptions = {
            showPriceAxisLabels: false,
            showTimeAxisLabels: false,
        } as Parameters<LineToolsApi["addLineTool"]>[2];

        const longShortOptions =
            drawingTool === "LongShortPosition"
                ? ({
                      showAutoText: true,
                      showPriceAxisLabels: false,
                      showTimeAxisLabels: false,
                  } as Parameters<LineToolsApi["addLineTool"]>[2])
                : undefined;

        const lineOptions =
            (drawingTool === "TrendLine" || drawingTool === "Path") && drawingLineColor
                ? ({
                      ...axisLabelOptions,
                      line: { color: drawingLineColor },
                  } as Parameters<LineToolsApi["addLineTool"]>[2])
                : undefined;

        const rectangleOptions =
            drawingTool === "Rectangle" && (rectangleFillColor || rectangleBorderColor)
                ? ({
                      ...axisLabelOptions,
                      rectangle: {
                          ...(rectangleFillColor ? { background: { color: rectangleFillColor } } : {}),
                          ...(rectangleBorderColor ? { border: { color: rectangleBorderColor } } : {}),
                      },
                  } as Parameters<LineToolsApi["addLineTool"]>[2])
                : undefined;

        const toolOptions =
            drawingTool === "Rectangle"
                ? rectangleOptions
                : drawingTool === "LongShortPosition"
                    ? longShortOptions
                    : lineOptions;
        lineToolsRef.current.addLineTool(drawingTool, undefined, toolOptions);
    }, [drawingTool, drawingLineColor, rectangleFillColor, rectangleBorderColor]);

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

        const selectedTargets = selectedTools.filter(
            (tool) => tool.toolType === "Rectangle" || tool.toolType === "TrendLine" || tool.toolType === "Path"
        );

        if (selectedTargets.length > 0) {
            selectedTargets.forEach((tool) => {
                if (tool.toolType === "Rectangle") {
                    applyToRectangle(tool.id);
                } else if (tool.toolType === "TrendLine" || tool.toolType === "Path") {
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
        } else if (lastSelected.toolType === "TrendLine" || lastSelected.toolType === "Path") {
            applyToLineTool(lastSelected.id, lastSelected.toolType);
        }
        window.setTimeout(() => {
            syncSelectionByIds([lastSelected.id], lastSelected.id);
        }, 0);
    }, [isChartReady, rectangleFillColor, rectangleBorderColor, drawingLineColor, parseDrawingToolExports, syncSelectionByIds]);

    useEffect(() => {
        if (!isChartReady || !lineToolsRef.current) return;
        const selectedRaw = lineToolsRef.current.getSelectedLineTools?.();
        if (selectedRaw) {
            try {
                const selectedTools = JSON.parse(selectedRaw) as Array<{ id: string; toolType: string; points?: Array<{ price: number }> }>;
                const selectedLongShort = selectedTools.find((tool) => tool.toolType === "LongShortPosition");
                if (selectedLongShort?.id && selectedLongShort.points) {
                    updateLongShortText({ id: selectedLongShort.id, points: selectedLongShort.points });
                    return;
                }
            } catch {
                // ignore
            }
        }

        const lastSelected = lastSelectedDrawingRef.current;
        if (lastSelected?.toolType === "LongShortPosition") {
            const raw = lineToolsRef.current.getLineToolByID?.(lastSelected.id);
            if (!raw) return;
            try {
                const parsed = JSON.parse(raw) as Array<{ id: string; toolType: string; points?: Array<{ price: number }> }>;
                const tool = parsed[0];
                if (tool?.id && tool.points) {
                    updateLongShortText({ id: tool.id, points: tool.points });
                }
            } catch {
                // ignore
            }
        }
    }, [isChartReady, longShortLots, longShortSymbol, updateLongShortText]);

    // Handle Delete key to remove selected drawing tools
    useEffect(() => {
        if (!isChartReady || !lineToolsRef.current) return;

        const handleKeyDown = (e: KeyboardEvent) => {
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
                lineToolsRef.current?.removeSelectedLineTools();
                window.setTimeout(() => clearAllDrawingSelections(), 0);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [clearAllDrawingSelections, isChartReady]);

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

            if (e.key === "0") {
                timeScale.fitContent();
                e.preventDefault();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isChartReady, isHovered]);

    useImperativeHandle(ref, () => ({
        fitContent: () => {
            chartRef.current?.timeScale().fitContent();
        },
        scrollToTrade,
        removeAllDrawingTools: () => {
            lineToolsRef.current?.removeAllLineTools();
            clearAllDrawingSelections();
        },
        exportAllDrawings: (): DrawingToolExport[] => {
            const lineTools = getLineToolsInternal();
            const toolsMap = lineTools?._tools;
            if (!toolsMap || toolsMap.size === 0) return [];
            const exports: DrawingToolExport[] = [];
            for (const tool of toolsMap.values()) {
                try {
                    const exp = tool.getExportData();
                    if (exp && exp.toolType && exp.points?.length > 0) {
                        exports.push(exp);
                    }
                } catch { /* skip corrupt tools */ }
            }
            return exports;
        },
        importDrawings: (drawings: DrawingToolExport[]) => {
            if (!lineToolsRef.current || drawings.length === 0) return;
            for (const drawing of drawings) {
                try {
                    lineToolsRef.current.addLineTool(
                        drawing.toolType,
                        drawing.points,
                        drawing.options as Parameters<LineToolsApi["addLineTool"]>[2]
                    );
                } catch { /* skip invalid */ }
            }
        },
        getViewportCenterTimestamp: (): number | null => {
            const timeScale = chartRef.current?.timeScale();
            if (!timeScale) return null;
            const range = timeScale.getVisibleRange();
            if (!range) return null;
            const centerSec = ((range.from as number) + (range.to as number)) / 2;
            return centerSec * 1000;
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
    }), [clearAllDrawingSelections, scrollToTrade, getLineToolsInternal]);

    // Update chart data and auto-scroll to trade
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const timeScale = chartRef.current?.timeScale();
        const previousBars = prevBarsRef.current;
        const currentRange = !autoScrollOnData && timeScale ? timeScale.getVisibleLogicalRange() : null;
        const appendOnlyUpdate =
            !autoScrollOnData &&
            (dataUpdateMode === "append" ||
                (dataUpdateMode === "auto" && isAppendOnlyUpdate(previousBars, data)));
        const prependedBarCount =
            !autoScrollOnData
                ? dataUpdateMode === "prepend"
                    ? Math.max(0, data.length - previousBars.length)
                    : dataUpdateMode === "auto"
                        ? getPrependedBarCount(previousBars, data)
                        : 0
                : 0;

        if (appendOnlyUpdate) {
            const appendedBars = data.slice(previousBars.length);
            if (appendedBars.length <= 50) {
                // Small appends: incremental updates (fast, flicker-free)
                for (const bar of appendedBars) {
                    seriesRef.current.update(toCandlestickPoint(bar));
                }
            } else {
                // Large appends: bulk setData (avoids main-thread freeze from 4000+ update calls)
                const formattedData = formatData(data);
                seriesRef.current.setData(formattedData);
                // Restore viewport SYNCHRONOUSLY to prevent flicker —
                // the browser hasn't painted yet, so there's no visible flash
                if (timeScale && currentRange && previousBars.length > 0) {
                    suppressVisibleRangeUntilRef.current = Date.now() + 60;
                    timeScale.setVisibleLogicalRange(currentRange);
                }
            }
        } else {
            const formattedData = formatData(data);
            seriesRef.current.setData(formattedData);
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
            prevBarsRef.current = data;
            return;
        }

        // Auto-scroll to trade location after data loads
        if (trade) {
            // Small delay to ensure chart has rendered
            setTimeout(() => {
                suppressVisibleRangeUntilRef.current = Date.now() + 120;
                scrollToTrade(zoomOutMultiplier);
            }, 50);
        } else {
            suppressVisibleRangeUntilRef.current = Date.now() + 120;
            chartRef.current?.timeScale().fitContent();
        }
        prevBarsRef.current = data;
    }, [data, isChartReady, formatData, trade, scrollToTrade, autoScrollOnData, dataUpdateMode, findNearestIndexByTimestamp, getPrependedBarCount, isAppendOnlyUpdate, toCandlestickPoint, zoomOutMultiplier]);

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

    return (
        <div
            className="relative w-full"
            style={{ height }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            {/* Loading overlay */}
            {isLoading && (
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
                className="w-full rounded-lg bg-gray-900/50"
                style={{ height }}
            />

            {timeGuideOverlay.verticalLines.length > 0 && (
                <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden rounded-lg">
                    {timeGuideOverlay.verticalLines.map((line) => (
                        <div
                            key={line.id}
                            className="absolute bottom-0 top-0"
                            style={{
                                left: `${line.x}px`,
                                borderLeft:
                                    line.kind === "daily"
                                        ? "1px dashed rgba(148, 163, 184, 0.55)"
                                        : "1px dashed rgba(250, 204, 21, 0.85)",
                            }}
                        />
                    ))}
                </div>
            )}
        </div>
    );
});
