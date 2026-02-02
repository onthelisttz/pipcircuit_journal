"use client";

import {
    createChart,
    type IChartApi,
    type ISeriesApi,
    type CandlestickData,
    type Time,
    type SeriesMarker,
    ColorType,
    LineStyle,
    CandlestickSeries,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";

export interface TradeCandlestickChartProps {
    /** Chart bar data to display */
    data: ChartBar[];
    /** Trade for context visualization (entry/exit markers) */
    trade?: Trade;
    /** Height of the chart container */
    height?: number;
    /** Show/hide entry marker */
    showEntryMarker?: boolean;
    /** Show/hide exit marker */
    showExitMarker?: boolean;
    /** Callback when visible range changes (for lazy loading) */
    onVisibleRangeChange?: (from: number, to: number) => void;
    /** Loading state */
    isLoading?: boolean;
}

/**
 * TradeCandlestickChart - Main candlestick chart component
 *
 * Uses TradingView Lightweight Charts v5 with dark theme,
 * entry/exit markers, and trade context visualization.
 */
export function TradeCandlestickChart({
    data,
    trade,
    height = 400,
    showEntryMarker = true,
    showExitMarker = true,
    onVisibleRangeChange,
    isLoading = false,
}: TradeCandlestickChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);

    // Convert ChartBar data to Lightweight Charts format
    const formatData = useCallback((bars: ChartBar[]): CandlestickData<Time>[] => {
        return bars.map((bar) => ({
            time: (bar.timestamp / 1000) as Time, // Convert ms to seconds
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
        }));
    }, []);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height,
            layout: {
                background: { type: ColorType.Solid, color: "transparent" },
                textColor: "#9ca3af",
                fontFamily: "'Inter', sans-serif",
            },
            grid: {
                vertLines: { color: "#1f2937" },
                horzLines: { color: "#1f2937" },
            },
            crosshair: {
                mode: 1, // Normal
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
                scaleMargins: { top: 0.1, bottom: 0.1 },
            },
            timeScale: {
                borderColor: "#374151",
                timeVisible: true,
                secondsVisible: false,
            },
        });

        // Add candlestick series (v5 API)
        const series = chart.addSeries(CandlestickSeries, {
            upColor: "#22c55e",
            downColor: "#ef4444",
            borderUpColor: "#22c55e",
            borderDownColor: "#ef4444",
            wickUpColor: "#22c55e",
            wickDownColor: "#ef4444",
        });

        chartRef.current = chart;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        seriesRef.current = series as any;
        setIsChartReady(true);

        // Handle resize
        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth });
            }
        };

        window.addEventListener("resize", handleResize);

        // Handle visible range changes for lazy loading
        if (onVisibleRangeChange) {
            chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (range && range.from !== undefined && range.to !== undefined) {
                    onVisibleRangeChange(range.from, range.to);
                }
            });
        }

        return () => {
            window.removeEventListener("resize", handleResize);
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            setIsChartReady(false);
        };
    }, [height, onVisibleRangeChange]);

    // Update chart data
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const formattedData = formatData(data);
        seriesRef.current.setData(formattedData);

        // Fit content to view
        chartRef.current?.timeScale().fitContent();
    }, [data, isChartReady, formatData]);

    // Add trade markers
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || !trade) return;

        const markers: SeriesMarker<Time>[] = [];

        const isBuy = trade.direction === Direction.Buy;
        const entryColor = isBuy ? "#22c55e" : "#ef4444";
        const exitColor = isBuy ? "#ef4444" : "#22c55e";

        if (showEntryMarker && trade.openTime) {
            markers.push({
                time: (trade.openTime.getTime() / 1000) as Time,
                position: isBuy ? "belowBar" : "aboveBar",
                color: entryColor,
                shape: isBuy ? "arrowUp" : "arrowDown",
                text: `Entry ${trade.openPrice?.toFixed(5) ?? ""}`,
            });
        }

        if (showExitMarker && trade.closeTime && trade.closePrice) {
            markers.push({
                time: (trade.closeTime.getTime() / 1000) as Time,
                position: isBuy ? "aboveBar" : "belowBar",
                color: exitColor,
                shape: "circle",
                text: `Exit ${trade.closePrice.toFixed(5)}`,
            });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (seriesRef.current as any).setMarkers(markers);
    }, [trade, isChartReady, showEntryMarker, showExitMarker]);

    return (
        <div className="relative w-full" style={{ height }}>
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
}
