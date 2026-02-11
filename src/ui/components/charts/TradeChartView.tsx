"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type { Trade, ChartTimeframe } from "@domain/entities";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { TradeCandlestickChart } from "./TradeCandlestickChart";
import { ProfitTimelineChart } from "./ProfitTimelineChart";
import { TimeframeSelector } from "./TimeframeSelector";
import { ChartControls } from "./ChartControls";
import { useChartData } from "@ui/hooks/useChartData";
import type { DrawingToolType, TradeCandlestickChartRef } from "./TradeCandlestickChart";
import { volumeToLots } from "@lib/pnl-estimate";

function formatProfit(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatHeaderDate(value: Date | number | string | undefined): string {
    if (!value) return "-";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

export interface TradeChartViewProps {
    /** Trade to visualize */
    trade: Trade;
    /** Which visualization to render */
    viewMode?: "combined" | "chart" | "pnl";
    /** Prefer a taller chart layout when parent panel is expanded */
    fillAvailableHeight?: boolean;
    /** Navigate to previous trade (from parent panel) */
    onPrevTrade?: () => void;
    /** Navigate to next trade (from parent panel) */
    onNextTrade?: () => void;
    /** Whether previous trade navigation is available */
    canPrevTrade?: boolean;
    /** Whether next trade navigation is available */
    canNextTrade?: boolean;
    /** 1-based position of current trade in list */
    currentTradePosition?: number;
    /** Total number of trades in list */
    totalTrades?: number;
    /** Controlled expanded state for chart modal */
    expanded?: boolean;
    /** Change handler for controlled expanded state */
    onExpandedChange?: (expanded: boolean) => void;
    /** Initial timeframe */
    initialTimeframe?: ChartTimeframe;
    /** Access token for API calls (optional) */
    accessToken?: string;
    /** Broker identifier for cache lookup (Dexie/Supabase - improves chart loading from local data) */
    broker?: string;
    /** Main chart height */
    chartHeight?: number;
    /** Profit timeline height */
    profitTimelineHeight?: number;
}

/**
 * TradeChartView - Complete trade chart visualization container
 *
 * Combines candlestick chart, profit timeline, timeframe selector,
 * and chart controls into a cohesive trade visualization.
 */
export function TradeChartView({
    trade,
    viewMode = "combined",
    fillAvailableHeight = false,
    onPrevTrade,
    onNextTrade,
    canPrevTrade = false,
    canNextTrade = false,
    currentTradePosition,
    totalTrades,
    expanded,
    onExpandedChange,
    initialTimeframe = "M1",
    accessToken,
    broker,
    chartHeight = 400,
    profitTimelineHeight = 200,
}: TradeChartViewProps) {
    const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
    const [showProfitTimeline, setShowProfitTimeline] = useState(viewMode !== "chart");
    const [showMAE, setShowMAE] = useState(true);
    const [showMFE, setShowMFE] = useState(true);
    const [showRiskReward, setShowRiskReward] = useState(true);
    const [showRiskRewardLabels, setShowRiskRewardLabels] = useState(true);
    const [internalExpanded, setInternalExpanded] = useState(false);
    const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
    const [viewportHeight, setViewportHeight] = useState(900);
    const [visualAreaHeight, setVisualAreaHeight] = useState(0);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const visualAreaRef = useRef<HTMLDivElement>(null);
    const candlestickChartRef = useRef<TradeCandlestickChartRef | null>(null);
    const profitChartRef = useRef<{ fitContent: () => void } | null>(null);
    const showsCandlestick = viewMode !== "pnl";
    const allowsProfitToggle = viewMode === "combined";
    const allowsProfitMarkers = viewMode !== "chart";
    const isExpanded = expanded ?? internalExpanded;

    const setExpanded = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
        const resolved = typeof next === "function" ? next(isExpanded) : next;
        if (expanded === undefined) {
            setInternalExpanded(resolved);
        }
        onExpandedChange?.(resolved);
    }, [expanded, isExpanded, onExpandedChange]);

    // Fetch chart data using custom hook (broker enables Dexie/Supabase cache lookup)
    const { data, isLoading, error, refetch } = useChartData({
        trade,
        timeframe,
        accessToken,
        broker,
    });

    // Handle timeframe change
    const handleTimeframeChange = useCallback((newTimeframe: ChartTimeframe) => {
        setTimeframe(newTimeframe);
    }, []);

    useEffect(() => {
        setShowProfitTimeline(viewMode !== "chart");
    }, [viewMode]);

    useEffect(() => {
        if (!(isExpanded || fillAvailableHeight)) return;

        const updateHeight = () => {
            setViewportHeight(window.innerHeight);
        };

        updateHeight();
        window.addEventListener("resize", updateHeight);
        return () => window.removeEventListener("resize", updateHeight);
    }, [isExpanded, fillAvailableHeight]);

    useEffect(() => {
        const el = visualAreaRef.current;
        if (!el) return;

        const updateHeight = () => {
            setVisualAreaHeight(el.clientHeight);
        };

        updateHeight();
        const observer =
            typeof ResizeObserver !== "undefined"
                ? new ResizeObserver(() => updateHeight())
                : null;
        observer?.observe(el);
        window.addEventListener("resize", updateHeight);

        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", updateHeight);
        };
    }, [isExpanded, fillAvailableHeight, viewMode, showProfitTimeline]);

    const resolvedChartHeight = useMemo(() => {
        if (showsCandlestick && !showProfitTimeline && visualAreaHeight > 0) {
            return Math.max(320, visualAreaHeight - 2);
        }
        if (isExpanded) return Math.max(500, viewportHeight - 230);
        if (fillAvailableHeight && showsCandlestick && !showProfitTimeline) {
            const maxChartHeight = Math.max(420, viewportHeight - 420);
            return Math.min(chartHeight, maxChartHeight);
        }
        return chartHeight;
    }, [
        isExpanded,
        fillAvailableHeight,
        showsCandlestick,
        showProfitTimeline,
        chartHeight,
        viewportHeight,
        visualAreaHeight,
    ]);

    const resolvedTimelineHeight = useMemo(() => {
        if (!showsCandlestick && visualAreaHeight > 0) {
            return Math.max(280, visualAreaHeight - 2);
        }
        if (isExpanded && !showsCandlestick) return Math.max(420, viewportHeight - 210);
        if (isExpanded && showsCandlestick) return Math.max(profitTimelineHeight, Math.floor((viewportHeight - 230) * 0.34));
        if (fillAvailableHeight && !showsCandlestick) return Math.max(profitTimelineHeight, viewportHeight - 320);
        return profitTimelineHeight;
    }, [
        isExpanded,
        showsCandlestick,
        fillAvailableHeight,
        profitTimelineHeight,
        viewportHeight,
        visualAreaHeight,
    ]);

    const activeZoomOutMultiplier = isExpanded ? 8.0 : fillAvailableHeight ? 5.0 : 3.4;
    const headerLots = useMemo(() => {
        if (trade.lots != null && Number.isFinite(trade.lots)) return trade.lots;
        return volumeToLots(trade.volume ?? 0, trade.symbol ?? "");
    }, [trade.lots, trade.volume, trade.symbol]);
    const headerPnl = trade.netProfit ?? trade.grossProfit ?? 0;
    const headerDate = trade.closeTime ?? trade.openTime;

    // Reset view - switch to M1, scroll to trade, fit charts, remove all drawing tools (delay to allow M1 data to load)
    const handleResetView = useCallback(() => {
        if (showsCandlestick) {
            // Remove drawing tools immediately when candlestick chart is visible.
            candlestickChartRef.current?.removeAllDrawingTools();
            setDrawingTool(null);
        }

        setTimeframe("M1");
        setTimeout(() => {
            if (showsCandlestick) {
                candlestickChartRef.current?.scrollToTrade(activeZoomOutMultiplier);
                candlestickChartRef.current?.fitContent();
            }
            profitChartRef.current?.fitContent();
        }, 150);
    }, [showsCandlestick, activeZoomOutMultiplier]);

    // Close expanded view on Escape, prevent body scroll when expanded
    useEffect(() => {
        if (!isExpanded) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setExpanded(false);
        };
        window.addEventListener("keydown", handler);
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", handler);
            document.body.style.overflow = "";
        };
    }, [isExpanded, setExpanded]);

    useEffect(() => {
        if (!showsCandlestick || !trade || isLoading) return;

        // Keep selected trade centered after switching next/prev and after layout changes.
        const firstPass = window.setTimeout(() => {
            candlestickChartRef.current?.scrollToTrade(activeZoomOutMultiplier);
        }, 80);
        const secondPass = window.setTimeout(() => {
            candlestickChartRef.current?.scrollToTrade(activeZoomOutMultiplier);
        }, isExpanded ? 260 : 170);

        return () => {
            window.clearTimeout(firstPass);
            window.clearTimeout(secondPass);
        };
    }, [
        activeZoomOutMultiplier,
        isExpanded,
        isLoading,
        showsCandlestick,
        timeframe,
        trade,
        trade.id,
        trade.openTime,
        trade.closeTime,
        data.length,
    ]);

    // Handle visible range change for lazy loading
    const handleVisibleRangeChange = useCallback(
        (from: number, to: number) => {
            // Check if user scrolled near edges for lazy loading
            const dataLength = data.length;
            const threshold = 0.2;

            if (from < dataLength * threshold) {
                // User scrolled to left edge, could load more historical data
                
            }

            if (to > dataLength * (1 - threshold)) {
                // User scrolled to right edge, could load more recent data
                
            }
        },
        [data.length]
    );

    const chartContent = (hideTimeframeInToolbar = false) => (
        <div className="flex min-h-0 flex-1 flex-col">
            <div
                className={`sticky top-0 z-10 -mx-2 -mt-2 flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-border/70 bg-card/95 px-2 py-1.5 backdrop-blur ${
                    hideTimeframeInToolbar ? "justify-end" : "justify-between"
                }`}
            >
                {!hideTimeframeInToolbar && (
                    <TimeframeSelector
                        value={timeframe}
                        onChange={handleTimeframeChange}
                        disabled={isLoading}
                    />
                )}
                <ChartControls
                    onResetView={handleResetView}
                    showProfitTimeline={showProfitTimeline}
                    onToggleProfitTimeline={
                        allowsProfitToggle
                            ? () => setShowProfitTimeline((prev) => !prev)
                            : undefined
                    }
                    showMAE={showMAE}
                    onToggleMAE={allowsProfitMarkers ? () => setShowMAE((prev) => !prev) : undefined}
                    showMFE={showMFE}
                    onToggleMFE={allowsProfitMarkers ? () => setShowMFE((prev) => !prev) : undefined}
                    showRiskReward={showsCandlestick ? showRiskReward : undefined}
                    onToggleRiskReward={
                        showsCandlestick ? () => setShowRiskReward((prev) => !prev) : undefined
                    }
                    showRiskRewardLabels={showsCandlestick ? showRiskRewardLabels : undefined}
                    onToggleRiskRewardLabels={
                        showsCandlestick
                            ? () => setShowRiskRewardLabels((prev) => !prev)
                            : undefined
                    }
                    isExpanded={isExpanded}
                    onToggleExpand={() => setExpanded((prev) => !prev)}
                    disabled={isLoading}
                    drawingTool={drawingTool}
                    onDrawingToolChange={showsCandlestick ? setDrawingTool : undefined}
                />
            </div>
            {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
                    <p>Failed to load chart data: {error.message}</p>
                    <button
                        onClick={() => refetch()}
                        className="mt-2 text-xs underline hover:no-underline"
                    >
                        Try again
                    </button>
                </div>
            )}
            <div ref={visualAreaRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pt-1">
                {showsCandlestick && (
                    <TradeCandlestickChart
                        ref={candlestickChartRef}
                        data={data}
                        trade={trade}
                        height={resolvedChartHeight}
                        zoomOutMultiplier={activeZoomOutMultiplier}
                        showEntryMarker={true}
                        showExitMarker={true}
                        onVisibleRangeChange={handleVisibleRangeChange}
                        isLoading={isLoading}
                        drawingTool={drawingTool}
                        showRiskReward={showRiskReward}
                        showRiskRewardLabels={showRiskRewardLabels}
                    />
                )}
                {showProfitTimeline && (
                    <ProfitTimelineChart
                        ref={profitChartRef}
                        data={data}
                        trade={trade}
                        height={resolvedTimelineHeight}
                        visible={showProfitTimeline}
                        showMAE={showMAE}
                        showMFE={showMFE}
                    />
                )}
            </div>
        </div>
    );

    if (isExpanded) {
        return (
            <>
                <div
                    className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
                    onClick={() => setExpanded(false)}
                    aria-hidden="true"
                />
                <div
                    ref={chartContainerRef}
                    className="fixed inset-2 z-50 flex flex-col rounded-2xl border border-border bg-background p-3 shadow-2xl md:inset-4 md:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded chart"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border pb-2">
                        <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                                {trade.symbol} - {trade.direction}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                                {headerLots.toFixed(2)} lots | {formatProfit(headerPnl)} | {formatHeaderDate(headerDate)}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {(onPrevTrade || onNextTrade) && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={onPrevTrade}
                                        disabled={!onPrevTrade || !canPrevTrade}
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                                    >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        Back
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onNextTrade}
                                        disabled={!onNextTrade || !canNextTrade}
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                                    >
                                        Next
                                        <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                    {typeof currentTradePosition === "number" &&
                                        typeof totalTrades === "number" &&
                                        totalTrades > 0 && (
                                            <span className="ml-1 text-[11px] text-muted-foreground tabular-nums">
                                                {currentTradePosition} of {totalTrades}
                                            </span>
                                        )}
                                </div>
                            )}
                            <TimeframeSelector
                                value={timeframe}
                                onChange={handleTimeframeChange}
                                disabled={isLoading}
                            />
                            <button
                                onClick={() => setExpanded(false)}
                                className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                title="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                        {chartContent(true)}
                    </div>
                </div>
            </>
        );
    }

    return (
        <div
            ref={chartContainerRef}
            className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-xl border border-border bg-card/80 p-2 pt-0"
        >
            {chartContent()}
        </div>
    );
}
