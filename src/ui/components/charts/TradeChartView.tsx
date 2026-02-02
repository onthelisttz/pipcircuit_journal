"use client";

import { useState, useCallback, useRef } from "react";
import type { Trade, ChartTimeframe } from "@domain/entities";
import { TradeCandlestickChart } from "./TradeCandlestickChart";
import { ProfitTimelineChart } from "./ProfitTimelineChart";
import { TimeframeSelector } from "./TimeframeSelector";
import { ChartControls } from "./ChartControls";
import { useChartData } from "@ui/hooks/useChartData";

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
    initialTimeframe = "M15",
    accessToken,
    chartHeight = 400,
    profitTimelineHeight = 120,
}: TradeChartViewProps) {
    const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
    const [showProfitTimeline, setShowProfitTimeline] = useState(true);
    const [showMAE, setShowMAE] = useState(true);
    const [showMFE, setShowMFE] = useState(true);
    const chartContainerRef = useRef<HTMLDivElement>(null);

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

    // Reset view - trigger chart to fit content
    const handleResetView = useCallback(() => {
        // The chart internally handles fit content
        // We can trigger a refetch to ensure latest data
        refetch();
    }, [refetch]);

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

    return (
        <div
            ref={chartContainerRef}
            className="flex flex-col gap-4 rounded-xl bg-gray-950/50 p-4"
        >
            {/* Header with controls */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <TimeframeSelector
                    value={timeframe}
                    onChange={handleTimeframeChange}
                    disabled={isLoading}
                />

                <ChartControls
                    onResetView={handleResetView}
                    showProfitTimeline={showProfitTimeline}
                    onToggleProfitTimeline={() => setShowProfitTimeline((prev) => !prev)}
                    showMAE={showMAE}
                    onToggleMAE={() => setShowMAE((prev) => !prev)}
                    showMFE={showMFE}
                    onToggleMFE={() => setShowMFE((prev) => !prev)}
                    disabled={isLoading}
                />
            </div>

            {/* Error state */}
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

            {/* Main candlestick chart */}
            <TradeCandlestickChart
                data={data}
                trade={trade}
                height={chartHeight}
                showEntryMarker={true}
                showExitMarker={true}
                onVisibleRangeChange={handleVisibleRangeChange}
                isLoading={isLoading}
            />

            {/* Profit timeline chart */}
            <ProfitTimelineChart
                data={data}
                trade={trade}
                height={profitTimelineHeight}
                visible={showProfitTimeline}
                showMAE={showMAE}
                showMFE={showMFE}
            />

            {/* Trade context info */}
            <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                <span>
                    Symbol: <span className="font-medium text-gray-300">{trade.symbol}</span>
                </span>
                <span>
                    Direction:{" "}
                    <span
                        className={`font-medium ${trade.direction === "Buy" ? "text-green-400" : "text-red-400"
                            }`}
                    >
                        {trade.direction}
                    </span>
                </span>
                <span>
                    Entry:{" "}
                    <span className="font-medium text-gray-300">
                        {trade.openPrice?.toFixed(5)}
                    </span>
                </span>
                {trade.closePrice && (
                    <span>
                        Exit:{" "}
                        <span className="font-medium text-gray-300">
                            {trade.closePrice.toFixed(5)}
                        </span>
                    </span>
                )}
                <span>
                    Bars: <span className="font-medium text-gray-300">{data.length}</span>
                </span>
            </div>
        </div>
    );
}
