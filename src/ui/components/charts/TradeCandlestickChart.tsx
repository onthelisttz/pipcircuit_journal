"use client";

import {
    createChart,
    createSeriesMarkers,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type CandlestickData,
    type Time,
    type SeriesMarker,
    ColorType,
    LineStyle,
    CandlestickSeries,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
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

export interface TradeCandlestickChartRef {
    fitContent: () => void;
}

/**
 * TradeCandlestickChart - Main candlestick chart component
 *
 * Uses TradingView Lightweight Charts v5 with dark theme,
 * entry/exit markers, and trade context visualization.
 */
export const TradeCandlestickChart = forwardRef<TradeCandlestickChartRef, TradeCandlestickChartProps>(function TradeCandlestickChart({
    data,
    trade,
    height = 400,
    showEntryMarker = true,
    showExitMarker = true,
    onVisibleRangeChange,
    isLoading = false,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const markersPluginRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const takeProfitLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);

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
        seriesRef.current = series;
        setIsChartReady(true);

        const handleResize = () => {
            if (containerRef.current) {
                chart.applyOptions({ width: containerRef.current.clientWidth });
            }
        };

        window.addEventListener("resize", handleResize);

        if (onVisibleRangeChange) {
            chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (range && range.from !== undefined && range.to !== undefined) {
                    onVisibleRangeChange(range.from, range.to);
                }
            });
        }

        return () => {
            window.removeEventListener("resize", handleResize);
            markersPluginRef.current = null;
            entryLineRef.current = null;
            stopLossLineRef.current = null;
            takeProfitLineRef.current = null;
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            setIsChartReady(false);
        };
    }, [height, onVisibleRangeChange]);

    useImperativeHandle(ref, () => ({
        fitContent: () => {
            chartRef.current?.timeScale().fitContent();
        },
    }), []);

    // Update chart data
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const formattedData = formatData(data);
        seriesRef.current.setData(formattedData);

        // Fit content to view
        chartRef.current?.timeScale().fitContent();
    }, [data, isChartReady, formatData]);

    // Add trade markers (Lightweight Charts v5) - run after data is set, snap times to bar boundaries
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const formattedData = formatData(data);
        const barTimes = formattedData.map((d) => d.time as number).sort((a, b) => a - b);

        const snapToNearestBar = (tsMs: number): Time => {
            const tsSec = tsMs / 1000;
            if (barTimes.length === 0) return tsSec as Time;
            let nearest = barTimes[0];
            let minDiff = Math.abs(barTimes[0] - tsSec);
            for (const t of barTimes) {
                const diff = Math.abs(t - tsSec);
                if (diff < minDiff) {
                    minDiff = diff;
                    nearest = t;
                }
            }
            return nearest as Time;
        };

        const markers: SeriesMarker<Time>[] = [];

        if (trade) {
            const isBuy = trade.direction === Direction.Buy;
            const entryColor = isBuy ? "#22c55e" : "#ef4444";
            const exitColor = isBuy ? "#ef4444" : "#22c55e";

            if (showEntryMarker && trade.openTime) {
                const openTs = trade.openTime instanceof Date ? trade.openTime.getTime() : new Date(trade.openTime).getTime();
                markers.push({
                    time: snapToNearestBar(openTs),
                    position: isBuy ? "belowBar" : "aboveBar",
                    color: entryColor,
                    shape: isBuy ? "arrowUp" : "arrowDown",
                    text: "",
                });
            }

            if (showExitMarker && trade.closeTime && trade.closePrice) {
                const closeTs = trade.closeTime instanceof Date ? trade.closeTime.getTime() : new Date(trade.closeTime).getTime();
                markers.push({
                    time: snapToNearestBar(closeTs),
                    position: isBuy ? "aboveBar" : "belowBar",
                    color: exitColor,
                    shape: "circle",
                    text: `Exit ${trade.closePrice.toFixed(5)}`,
                });
            }
        }

        if (!markersPluginRef.current) {
            markersPluginRef.current = createSeriesMarkers(seriesRef.current, markers);
        } else {
            markersPluginRef.current.setMarkers(markers);
        }
    }, [trade, data, isChartReady, formatData, showEntryMarker, showExitMarker]);

    // Add entry, stop loss, take profit price lines (dotted, no label on entry)
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || !trade) return;

        const series = seriesRef.current;

        // Remove existing price lines
        if (entryLineRef.current) {
            series.removePriceLine(entryLineRef.current);
            entryLineRef.current = null;
        }
        if (stopLossLineRef.current) {
            series.removePriceLine(stopLossLineRef.current);
            stopLossLineRef.current = null;
        }
        if (takeProfitLineRef.current) {
            series.removePriceLine(takeProfitLineRef.current);
            takeProfitLineRef.current = null;
        }

        const entryPrice = trade.entryPrice ?? trade.openPrice;
        const isBuy = trade.direction === Direction.Buy;
        const lineColor = isBuy ? "#22c55e" : "#ef4444";

        // Entry line: dotted, no label
        if (entryPrice != null && Number.isFinite(entryPrice)) {
            entryLineRef.current = series.createPriceLine({
                price: entryPrice,
                color: lineColor,
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: false,
                title: "",
            });
        }

        // Stop loss: dotted
        if (trade.stopLoss != null && Number.isFinite(trade.stopLoss)) {
            stopLossLineRef.current = series.createPriceLine({
                price: trade.stopLoss,
                color: "#ef4444",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `SL ${trade.stopLoss.toFixed(5)}`,
            });
        }

        // Take profit: dotted
        if (trade.takeProfit != null && Number.isFinite(trade.takeProfit)) {
            takeProfitLineRef.current = series.createPriceLine({
                price: trade.takeProfit,
                color: "#22c55e",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `TP ${trade.takeProfit.toFixed(5)}`,
            });
        }
    }, [trade, isChartReady]);

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
});
