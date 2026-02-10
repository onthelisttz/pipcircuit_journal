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
    CrosshairMode,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { estimateGrossProfit, volumeToLots } from "@lib/pnl-estimate";
import { RiskRewardPlugin } from "./plugins/RiskRewardPlugin";
import { createLineToolsPlugin } from "lightweight-charts-line-tools-core";
import { LineToolRectangle } from "lightweight-charts-line-tools-rectangle";
import { registerLinesPlugin } from "lightweight-charts-line-tools-lines";
import { registerPathPlugin } from "lightweight-charts-line-tools-path";
import { registerLongShortPositionPlugin } from "lightweight-charts-line-tools-long-short-position";

export type DrawingToolType = "Path" | "TrendLine" | "Rectangle" | "LongShortPosition";

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
    /** Show automatic risk/reward zones from trade data */
    showRiskReward?: boolean;
}

export interface TradeCandlestickChartRef {
    fitContent: () => void;
    scrollToTrade: () => void;
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
    showRiskReward = true,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
    const entryLineRef = useRef<IPriceLine | null>(null);
    const stopLossLineRef = useRef<IPriceLine | null>(null);
    const exitLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);

    const riskRewardPluginRef = useRef<RiskRewardPlugin | null>(null);
    const lineToolsRef = useRef<ReturnType<typeof createLineToolsPlugin> | null>(null);

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
            lineToolsRef.current?.removeAllLineTools();
            lineToolsRef.current = null;
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

    useEffect(() => {
        if (!lineToolsRef.current || !drawingTool) return;
        const longShortOptions =
            drawingTool === "LongShortPosition"
                ? ({
                      showAutoText: false,
                      showPriceAxisLabels: false,
                      showTimeAxisLabels: false,
                  } as Parameters<typeof lineToolsRef.current.addLineTool>[2])
                : undefined;
        lineToolsRef.current.addLineTool(drawingTool, undefined, longShortOptions);
    }, [drawingTool]);

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

                console.log(`[TradeChart] Scaling Mismatch Detected. Ratio: ${ratio.toFixed(2)}, Applied Multiplier: ${multiplier}`);
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
        if (showRiskZone && rawEntry != null && rawRiskPrice != null) {
            const riskDollar = estimateGrossProfit(rawEntry, rawRiskPrice, lots, direction, symbol);
            if (Number.isFinite(riskDollar) && Math.abs(riskDollar) < 1_000_000) {
                const sign = riskDollar >= 0 ? "+" : "";
                riskLabel = `${sign}$${riskDollar.toFixed(2)}`;
            }
        }

        let rewardLabel: string | undefined;
        if (actualProfit != null && Number.isFinite(actualProfit) && Math.abs(actualProfit) < 1_000_000) {
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
            netProfit != null && Number.isFinite(netProfit)
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
    }, [data, isChartReady, trade, showRiskReward]);

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
