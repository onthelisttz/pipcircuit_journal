"use client";

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
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { RiskRewardPlugin } from "./plugins/RiskRewardPlugin";

export interface TradeCandlestickChartProps {
    /** Chart bar data to display */
    data: ChartBar[];
    /** Trade for context visualization */
    trade?: Trade;
    /** Height of the chart container */
    height?: number;
    /** Callback when visible range changes (for lazy loading) */
    onVisibleRangeChange?: (from: number, to: number) => void;
    /** Loading state */
    isLoading?: boolean;
}

export interface TradeCandlestickChartRef {
    fitContent: () => void;
    scrollToTrade: () => void;
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
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const exitLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);

    const riskRewardPluginRef = useRef<RiskRewardPlugin | null>(null);

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
    const scrollToTrade = useCallback(() => {
        if (!chartRef.current || !trade || data.length === 0) return;

        const openTs = trade.openTime instanceof Date ? trade.openTime.getTime() : new Date(trade.openTime).getTime();
        const closeTs = trade.closeTime
            ? (trade.closeTime instanceof Date ? trade.closeTime.getTime() : new Date(trade.closeTime).getTime())
            : openTs;

        const openSec = openTs / 1000;
        const closeSec = closeTs / 1000;
        const tradeDuration = Math.max(closeSec - openSec, 60); // At least 1 minute
        const padding = tradeDuration * 0.5; // 50% padding on each side

        chartRef.current.timeScale().setVisibleRange({
            from: (openSec - padding) as Time,
            to: (closeSec + padding) as Time,
        });
    }, [trade, data.length]);

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current) return;

        const chart = createChart(containerRef.current, {
            width: containerRef.current.clientWidth,
            height,
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
                scaleMargins: { top: 0.15, bottom: 0.15 },
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
            entryLineRef.current = null;
            stopLossLineRef.current = null;
            exitLineRef.current = null;
            riskRewardPluginRef.current = null;
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
        scrollToTrade,
    }), [scrollToTrade]);

    // Update chart data and auto-scroll to trade
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const formattedData = formatData(data);
        seriesRef.current.setData(formattedData);

        // Auto-scroll to trade location after data loads
        if (trade) {
            // Small delay to ensure chart has rendered
            setTimeout(() => scrollToTrade(), 50);
        } else {
            chartRef.current?.timeScale().fitContent();
        }
    }, [data, isChartReady, formatData, trade, scrollToTrade]);

    // Manage R:R Visualization (Plugin + Price Lines) with Adaptive Scaling
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || !trade || data.length === 0) return;

        const series = seriesRef.current;
        let entryPrice = trade.entryPrice ?? trade.openPrice;
        let rewardPrice = trade.closePrice ?? trade.takeProfit;
        let stopLoss = trade.stopLoss;
        const openTime = trade.openTime;

        // --- ADAPTIVE SCALING LOGIC (Robust Power of 10) ---
        // Calculate average close price from data to check scale
        const avgPrice = data.reduce((sum, bar) => sum + bar.close, 0) / data.length;

        if (entryPrice && avgPrice > 0) {
            const ratio = avgPrice / entryPrice;
            const logDiff = Math.log10(ratio);
            const magnitude = Math.round(logDiff);

            // Only apply scaling if the difference is substantial (at least 1 order of magnitude, e.g. 10x)
            if (Math.abs(magnitude) >= 1) {
                const multiplier = Math.pow(10, magnitude);

                // Apply scaling correction to trade levels
                entryPrice = entryPrice * multiplier;
                if (rewardPrice) rewardPrice = rewardPrice * multiplier;
                if (stopLoss) stopLoss = stopLoss * multiplier;

                console.log(`[TradeChart] Scaling Mismatch Detected. Ratio: ${ratio.toFixed(2)}, Applied Multiplier: ${multiplier}`);
            }
        }
        // -----------------------------

        // 1. Manage Price Lines (Labels Only - Line Hidden)
        // Remove existing
        if (entryLineRef.current) { series.removePriceLine(entryLineRef.current); entryLineRef.current = null; }
        if (stopLossLineRef.current) { series.removePriceLine(stopLossLineRef.current); stopLossLineRef.current = null; }
        if (exitLineRef.current) { series.removePriceLine(exitLineRef.current); exitLineRef.current = null; }

        // Entry Label
        if (entryPrice != null && Number.isFinite(entryPrice)) {
            entryLineRef.current = series.createPriceLine({
                price: entryPrice,
                color: "#6b7280", // Neutral gray
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                lineVisible: false, // Hide the infinite line
                title: "ENTRY",
            });
        }

        // SL Label
        if (stopLoss != null && Number.isFinite(stopLoss)) {
            stopLossLineRef.current = series.createPriceLine({
                price: stopLoss,
                color: "#ef4444", // Red text
                lineWidth: 1,
                lineStyle: LineStyle.Dotted, // Minimal line
                axisLabelVisible: true,
                lineVisible: false, // Hide the infinite line
                title: "SL",
            });
        }

        // TP/Exit Label
        if (rewardPrice != null && Number.isFinite(rewardPrice)) {
            const isProfit = (trade.netProfit ?? 0) >= 0;
            const color = trade.closePrice ? (isProfit ? "#22c55e" : "#ef4444") : "#22c55e"; // Green for TP target

            exitLineRef.current = series.createPriceLine({
                price: rewardPrice,
                color: color,
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                lineVisible: false, // Hide the infinite line
                title: trade.closePrice ? "EXIT" : "TP",
            });
        }

        // 2. Manage RiskRewardPlugin (The Box)
        if (entryPrice != null && stopLoss != null && rewardPrice != null && data.length > 0) {

            // Safe timestamp snapper - finds nearest bar to prevent plugin from receiving invalid time
            const findClosestTime = (targetDate: Date | string | number): Time => {
                const targetTs = new Date(targetDate).getTime();
                // Find bar with closest timestamp
                const closest = data.reduce((prev, curr) =>
                    Math.abs(curr.timestamp - targetTs) < Math.abs(prev.timestamp - targetTs) ? curr : prev
                );
                return (closest.timestamp / 1000) as Time;
            };

            const startTs = findClosestTime(openTime);

            // Pass closeTime if trade is closed
            let endTs: Time | null = null;
            if (trade.closeTime) {
                endTs = findClosestTime(trade.closeTime);
            }

            if (!riskRewardPluginRef.current) {
                // Create new plugin
                const plugin = new RiskRewardPlugin(entryPrice, stopLoss, rewardPrice, startTs, endTs);
                series.attachPrimitive(plugin);
                riskRewardPluginRef.current = plugin;
            } else {
                // Update existing
                riskRewardPluginRef.current.updateData(entryPrice, stopLoss, rewardPrice, startTs, endTs);
            }
        }

    }, [data, isChartReady, trade]); // data dependency vital for scaling calc checks

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
