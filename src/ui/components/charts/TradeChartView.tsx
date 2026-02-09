"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { Trade, ChartTimeframe } from "@domain/entities";
import { X } from "lucide-react";
import { TradeCandlestickChart } from "./TradeCandlestickChart";
import { ProfitTimelineChart } from "./ProfitTimelineChart";
import { TimeframeSelector } from "./TimeframeSelector";
import { ChartControls } from "./ChartControls";
import { useChartData } from "@ui/hooks/useChartData";
import type { DrawingToolType, TradeCandlestickChartRef } from "./TradeCandlestickChart";

export interface TradeChartViewProps {
    /** Trade to visualize */
    trade: Trade;
    /** Initial timeframe */
    initialTimeframe?: ChartTimeframe;
    /** Access token for API calls (optional) */
    accessToken?: string;
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
    initialTimeframe = "M1",
    accessToken,
    chartHeight = 400,
    profitTimelineHeight = 200,
}: TradeChartViewProps) {
    const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
    const [showProfitTimeline, setShowProfitTimeline] = useState(true);
    const [showMAE, setShowMAE] = useState(true);
    const [showMFE, setShowMFE] = useState(true);
    const [showRiskReward, setShowRiskReward] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const [drawingTool, setDrawingTool] = useState<DrawingToolType | null>(null);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const candlestickChartRef = useRef<TradeCandlestickChartRef | null>(null);
    const profitChartRef = useRef<{ fitContent: () => void } | null>(null);

    // Fetch chart data using custom hook
    const { data, isLoading, error, refetch } = useChartData({
        trade,
        timeframe,
        accessToken,
    });

    // Handle timeframe change
    const handleTimeframeChange = useCallback((newTimeframe: ChartTimeframe) => {
        setTimeframe(newTimeframe);
    }, []);

    // Reset view - switch to M1, scroll to trade, fit charts, remove all drawing tools (delay to allow M1 data to load)
    const handleResetView = useCallback(() => {
        // Remove all drawing tools immediately
        candlestickChartRef.current?.removeAllDrawingTools();
        setDrawingTool(null); // Clear active drawing tool selection
        
        setTimeframe("M1");
        setTimeout(() => {
            candlestickChartRef.current?.scrollToTrade();
            candlestickChartRef.current?.fitContent();
            profitChartRef.current?.fitContent();
        }, 150);
    }, []);

    // Close expanded view on Escape, prevent body scroll when expanded
    useEffect(() => {
        if (!isExpanded) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === "Escape") setIsExpanded(false);
        };
        window.addEventListener("keydown", handler);
        document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", handler);
            document.body.style.overflow = "";
        };
    }, [isExpanded]);

    // Handle visible range change for lazy loading
    const handleVisibleRangeChange = useCallback(
        (from: number, to: number) => {
            // Check if user scrolled near edges for lazy loading
            const dataLength = data.length;
            const threshold = 0.2;

            if (from < dataLength * threshold) {
                // User scrolled to left edge, could load more historical data
                console.log("Near left edge - consider loading earlier data");
            }

            if (to > dataLength * (1 - threshold)) {
                // User scrolled to right edge, could load more recent data
                console.log("Near right edge - consider loading later data");
            }
        },
        [data.length]
    );

    const chartContent = (hideTimeframeInToolbar = false) => (
        <>
            <div
                className={`sticky top-0 z-10 -mx-4 -mt-4 flex flex-nowrap items-center gap-3 overflow-x-auto bg-gray-950 px-4 py-2 ${
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
                    onToggleProfitTimeline={() => setShowProfitTimeline((prev) => !prev)}
                    showMAE={showMAE}
                    onToggleMAE={() => setShowMAE((prev) => !prev)}
                    showMFE={showMFE}
                    onToggleMFE={() => setShowMFE((prev) => !prev)}
                    showRiskReward={showRiskReward}
                    onToggleRiskReward={() => setShowRiskReward((prev) => !prev)}
                    isExpanded={isExpanded}
                    onToggleExpand={() => setIsExpanded((prev) => !prev)}
                    disabled={isLoading}
                    drawingTool={drawingTool}
                    onDrawingToolChange={setDrawingTool}
                />
            </div>
            {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
                    <p>Failed to load chart data: {error.message}</p>
                    <button
                        onClick={() => refetch()}
                        className="mt-2 text-xs underline hover:no-underline"
                    >
                        Try again
                    </button>
                </div>
            )}
            <TradeCandlestickChart
                ref={candlestickChartRef}
                data={data}
                trade={trade}
                height={isExpanded ? 550 : chartHeight}
                showEntryMarker={true}
                showExitMarker={true}
                onVisibleRangeChange={handleVisibleRangeChange}
                isLoading={isLoading}
                drawingTool={drawingTool}
                showRiskReward={showRiskReward}
            />
            <ProfitTimelineChart
                ref={profitChartRef}
                data={data}
                trade={trade}
                height={profitTimelineHeight}
                visible={showProfitTimeline}
                showMAE={showMAE}
                showMFE={showMFE}
            />
        </>
    );

    if (isExpanded) {
        return (
            <>
                <div
                    className="fixed inset-0 z-40 bg-black/80"
                    onClick={() => setIsExpanded(false)}
                    aria-hidden="true"
                />
                <div
                    ref={chartContainerRef}
                    className="fixed inset-4 z-50 flex flex-col gap-3 rounded-xl bg-gray-950 p-4 shadow-2xl"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded chart"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex shrink-0 items-center justify-between gap-3">
                        <span className="truncate text-sm font-medium text-gray-200">
                            {trade.symbol} · {trade.direction}
                        </span>
                        <div className="flex shrink-0 items-center gap-2">
                            <TimeframeSelector
                                value={timeframe}
                                onChange={handleTimeframeChange}
                                disabled={isLoading}
                            />
                            <button
                                onClick={() => setIsExpanded(false)}
                                className="rounded p-1.5 text-muted-foreground hover:bg-gray-800 hover:text-white"
                                title="Close"
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-auto">
                        {chartContent(true)}
                    </div>
                </div>
            </>
        );
    }

    return (
        <div
            ref={chartContainerRef}
            className="flex flex-col gap-4 rounded-xl bg-gray-950/50 p-4 pt-0"
        >
            {chartContent()}
        </div>
    );
}
