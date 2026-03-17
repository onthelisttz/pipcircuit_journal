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
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { estimateGrossProfit, volumeToLots, priceDiffToPips } from "@lib/pnl-estimate";
import { RiskRewardPlugin } from "./plugins/RiskRewardPlugin";
import { createLineToolsPlugin } from "lightweight-charts-line-tools-core";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { registerLinesPlugin } from "lightweight-charts-line-tools-lines";
import { registerPathPlugin } from "lightweight-charts-line-tools-path";
import { registerLongShortPositionPlugin } from "lightweight-charts-line-tools-long-short-position";

export type DrawingToolType = "Path" | "TrendLine" | "Rectangle" | "LongShortPosition";
type LineToolsApi = ReturnType<typeof createLineToolsPlugin>;

export interface TradeCandlestickChartProps {
    /** Chart bar data to display */
    data: ChartBar[];
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
}

export interface TradeCandlestickChartRef {
    fitContent: () => void;
    scrollToTrade: (zoomOutMultiplier?: number) => void;
    removeAllDrawingTools: () => void;
}

/**
 * TradeCandlestickChart - Main candlestick chart component
 *
 * Uses TradingView Lightweight Charts v5 with dark theme (Pure Black),
 * R:R visualization with timestamp snapping for finite boxes.
 */
export const TradeCandlestickChart = forwardRef<TradeCandlestickChartRef, TradeCandlestickChartProps>(function TradeCandlestickChart({
    data,
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
    onRectangleSelectionChange,
    showRiskReward = true,
    showRiskRewardLabels = true,
    autoScrollOnData = true,
    zoomOutMultiplier = 3.2,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const exitLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const onVisibleRangeChangeRef = useRef<typeof onVisibleRangeChange>(onVisibleRangeChange);
    const onDrawingSelectionChangeRef = useRef<typeof onDrawingSelectionChange>(onDrawingSelectionChange);
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
        onRectangleSelectionChangeRef.current = onRectangleSelectionChange;
    }, [onRectangleSelectionChange]);

    const updateDrawingSelection = useCallback(() => {
        if (!lineToolsRef.current) return;
        const selectedRaw = lineToolsRef.current.getSelectedLineTools?.();
        if (!selectedRaw) {
            onDrawingSelectionChangeRef.current?.(null);
            onRectangleSelectionChangeRef.current?.(false);
            return;
        }
        try {
            const selectedTools = JSON.parse(selectedRaw) as Array<{ id: string; toolType: string }>;
            if (selectedTools.length === 0) {
                onDrawingSelectionChangeRef.current?.(null);
                onRectangleSelectionChangeRef.current?.(false);
                return;
            }
            const match = selectedTools.find((tool) =>
                tool.toolType === "Rectangle" ||
                tool.toolType === "TrendLine" ||
                tool.toolType === "Path" ||
                tool.toolType === "LongShortPosition"
            ) as { id: string; toolType: DrawingToolType } | undefined;
            if (!match) {
                onDrawingSelectionChangeRef.current?.(null);
                onRectangleSelectionChangeRef.current?.(false);
                return;
            }
            lineToolsRef.current.applyLineToolOptions({
                id: match.id,
                toolType: match.toolType,
                options: {
                    showPriceAxisLabels: false,
                    showTimeAxisLabels: false,
                },
            } as Parameters<LineToolsApi["applyLineToolOptions"]>[0]);
            lastSelectedDrawingRef.current = { id: match.id, toolType: match.toolType };
            onDrawingSelectionChangeRef.current?.(match.toolType);
            onRectangleSelectionChangeRef.current?.(match.toolType === "Rectangle");
        } catch {
            onDrawingSelectionChangeRef.current?.(null);
            onRectangleSelectionChangeRef.current?.(false);
        }
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

    // Convert ChartBar data to Lightweight Charts format (sorted, deduplicated by time)
    const formatData = useCallback((bars: ChartBar[]): CandlestickData<Time>[] => {
        const sorted = [...bars].sort((a, b) => a.timestamp - b.timestamp);
        const byTime = new Map<number, CandlestickData<Time>>();
        for (const bar of sorted) {
            const time = (bar.timestamp / 1000) as Time;
            byTime.set(bar.timestamp, {
                time,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
            });
        }
        return Array.from(byTime.values()).sort((a, b) => (a.time as number) - (b.time as number));
    }, []);

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

        const chart = createChart(containerRef.current, {
            width: Math.max(containerRef.current.clientWidth, 1),
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
                timeFormatter: (time: unknown) => {
                    let date: Date;
                    if (typeof time === "number") {
                        date = new Date(time * 1000);
                    } else if (typeof time === "string") {
                        date = new Date(time);
                    } else if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
                        const t = time as { year: number; month: number; day: number };
                        date = new Date(t.year, t.month - 1, t.day);
                    } else {
                        return String(time ?? "");
                    }
                    return date.toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                    });
                },
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
            selectedLineTool?: { id: string; toolType: string; points?: Array<{ price: number }> };
            stage?: string;
        }) => {
            const toolType = params?.selectedLineTool?.toolType as DrawingToolType | undefined;
            if (toolType === "Rectangle" || toolType === "TrendLine" || toolType === "Path" || toolType === "LongShortPosition") {
                const toolId = params?.selectedLineTool?.id;
                if (toolId) {
                    lastSelectedDrawingRef.current = { id: toolId, toolType };
                }
            }

            if (toolType === "Rectangle" && params.stage === "lineToolFinished") {
                const rectId = params.selectedLineTool?.id;
                if (!rectId) {
                    queueSelectionUpdate();
                    return;
                }
                lineTools.applyLineToolOptions({
                    id: rectId,
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
                        id: rectId,
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
                const toolId = params?.selectedLineTool?.id;
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

            queueSelectionUpdate();
        };
        const handleDoubleClick = (params: { selectedLineTool?: { id: string; toolType: string } }) => {
            const toolType = params?.selectedLineTool?.toolType as DrawingToolType | undefined;
            if (toolType === "Rectangle" || toolType === "TrendLine" || toolType === "Path" || toolType === "LongShortPosition") {
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

        const handlePointerDown = () => {
            queueSelectionUpdate();
        };
        const handlePointerUp = () => {
            queueSelectionUpdate();
        };
        containerRef.current?.addEventListener("pointerdown", handlePointerDown, true);
        containerRef.current?.addEventListener("pointerup", handlePointerUp, true);

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
        };

        window.addEventListener("resize", handleResize);

        const resizeObserver =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => syncChartSize())
                : null;
        if (resizeObserver && containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        const handleVisibleRange = (range: { from: number; to: number } | null) => {
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
            containerRef.current?.removeEventListener("pointerdown", handlePointerDown, true);
            containerRef.current?.removeEventListener("pointerup", handlePointerUp, true);
            lineToolsRef.current = null;
            window.removeEventListener("resize", handleResize);
            window.clearTimeout(timeoutId);
            cancelAnimationFrame(rafId);
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
    }, []);

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

        const selectedRaw = lineToolsRef.current.getSelectedLineTools?.();
        if (!selectedRaw) return;

        let selectedTools: Array<{ id: string; toolType: string; points?: unknown[] }> = [];
        try {
            selectedTools = JSON.parse(selectedRaw) as Array<{ id: string; toolType: string; points?: unknown[] }>;
        } catch {
            return;
        }

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
            return;
        }

        const lastSelected = lastSelectedDrawingRef.current;
        if (!lastSelected) return;

        if (lastSelected.toolType === "Rectangle") {
            applyToRectangle(lastSelected.id);
        } else if (lastSelected.toolType === "TrendLine" || lastSelected.toolType === "Path") {
            applyToLineTool(lastSelected.id, lastSelected.toolType);
        }
    }, [isChartReady, rectangleFillColor, rectangleBorderColor, drawingLineColor]);

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
            // Delete or Backspace key
            if ((e.key === "Delete" || e.key === "Backspace") && !e.ctrlKey && !e.metaKey && !e.altKey) {
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
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isChartReady]);

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
        },
    }), [scrollToTrade]);

    // Update chart data and auto-scroll to trade
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const timeScale = chartRef.current?.timeScale();
        const previousBars = prevBarsRef.current;
        const currentRange = !autoScrollOnData && timeScale ? timeScale.getVisibleLogicalRange() : null;

        const formattedData = formatData(data);
        seriesRef.current.setData(formattedData);

        if (!autoScrollOnData) {
            if (timeScale && currentRange && previousBars.length > 0) {
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
                    if (delta !== 0 && Math.abs(delta) < data.length) {
                        suppressVisibleRangeUntilRef.current = Date.now() + 120;
                        requestAnimationFrame(() => {
                            timeScale.setVisibleLogicalRange({
                                from: currentRange.from + delta,
                                to: currentRange.to + delta,
                            });
                        });
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
    }, [data, isChartReady, formatData, trade, scrollToTrade, autoScrollOnData, findNearestIndexByTimestamp, zoomOutMultiplier]);

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
        </div>
    );
});
