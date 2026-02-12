"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import {
    createChart,
    type IChartApi,
    type IPriceLine,
    type ISeriesApi,
    type LineData,
    type Time,
    ColorType,
    LineStyle,
    LineSeries,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";
import { estimateGrossProfit, volumeToLots } from "@lib/pnl-estimate";

export interface ProfitTimelineChartProps {
    /** Chart bar data to calculate P&L from */
    data: ChartBar[];
    /** Trade for P&L calculation */
    trade: Trade;
    /** Height of the chart container */
    height?: number;
    /** Whether to show the chart */
    visible?: boolean;
    /** Show MAE marker */
    showMAE?: boolean;
    /** Show MFE marker */
    showMFE?: boolean;
}

export interface ProfitTimelineChartRef {
    fitContent: () => void;
}

interface ProfitPoint {
    time: number;
    profit: number;
}

/**
 * ProfitTimelineChart - Floating P&L visualization during trade
 *
 * Shows profit/loss evolution during trade duration with MAE/MFE markers.
 */
export const ProfitTimelineChart = forwardRef<ProfitTimelineChartRef, ProfitTimelineChartProps>(function ProfitTimelineChart({
    data,
    trade,
    height = 120,
    visible = true,
    showMAE = true,
    showMFE = true,
}, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const maeLineRef = useRef<IPriceLine | null>(null);
    const mfeLineRef = useRef<IPriceLine | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);
    const [mae, setMae] = useState<ProfitPoint | null>(null);
    const [mfe, setMfe] = useState<ProfitPoint | null>(null);

    // Calculate floating P&L for each bar within trade duration
    const calculateProfitTimeline = useCallback(
        (bars: ChartBar[], tradeData: Trade): LineData<Time>[] => {
            if (!tradeData.openTime || !tradeData.openPrice) return [];

            const openTime = tradeData.openTime instanceof Date
                ? tradeData.openTime.getTime()
                : new Date(tradeData.openTime).getTime();
            const closeTime = tradeData.closeTime
                ? (tradeData.closeTime instanceof Date ? tradeData.closeTime.getTime() : new Date(tradeData.closeTime).getTime())
                : Date.now();
            const rawOpen = tradeData.openPrice;
            const rawClose = tradeData.closePrice ?? tradeData.entryPrice ?? tradeData.openPrice;
            const actualProfit = Number(tradeData.netProfit ?? tradeData.grossProfit ?? NaN);
            const lots =
                (tradeData.lots ?? volumeToLots(tradeData.volume ?? 100, tradeData.symbol ?? "")) || 0.01;
            const symbol = tradeData.symbol ?? "";
            const direction = tradeData.direction === Direction.Buy ? "Buy" : "Sell";

            // Infer correct entry/exit from actual profit (trade data may have them swapped)
            let openPrice: number;
            let closePrice: number;
            if (
                rawClose != null &&
                Number.isFinite(rawClose) &&
                Number.isFinite(actualProfit) &&
                Math.abs(actualProfit) < 1_000_000
            ) {
                if (actualProfit >= 0) {
                    openPrice = direction === "Sell" ? Math.max(rawOpen, rawClose) : Math.min(rawOpen, rawClose);
                    closePrice = direction === "Sell" ? Math.min(rawOpen, rawClose) : Math.max(rawOpen, rawClose);
                } else {
                    openPrice = rawOpen;
                    closePrice = rawClose;
                }
            } else {
                openPrice = rawOpen;
                closePrice = rawClose ?? rawOpen;
            }

            const tradeBars = bars.filter(
                (bar) => bar.timestamp >= openTime && bar.timestamp <= closeTime
            );

            // Normalize bar prices to match trade scale (bars API may return different scale for XAUUSD etc.)
            const refPrice = openPrice;
            const barScale =
                refPrice > 0 && refPrice < 100_000 && tradeBars.length > 0
                    ? (() => {
                          const sample = tradeBars[Math.floor(tradeBars.length / 2)].close;
                          if (sample > refPrice * 100) {
                              const ratio = sample / refPrice;
                              const scale = Math.pow(10, Math.round(Math.log10(ratio)));
                              return scale > 1 ? scale : 1;
                          }
                          return 1;
                      })()
                    : 1;

            const toBarPrice = (raw: number) => raw / barScale;

            let minProfit: ProfitPoint | null = null;
            let maxProfit: ProfitPoint | null = null;

            const profitData = tradeBars.map((bar) => {
                const barClose = toBarPrice(bar.close);
                const profit = estimateGrossProfit(openPrice, barClose, lots, direction, symbol);

                if (minProfit === null || profit < minProfit.profit) {
                    minProfit = { time: bar.timestamp, profit };
                }
                if (maxProfit === null || profit > maxProfit.profit) {
                    maxProfit = { time: bar.timestamp, profit };
                }

                return {
                    time: (bar.timestamp / 1000) as Time,
                    value: profit,
                };
            });

            setMae(minProfit);
            setMfe(maxProfit);

            // Sort by time and deduplicate (Lightweight Charts requires strictly ascending, no duplicates)
            const byTime = new Map<number, { time: Time; value: number }>();
            for (const p of profitData) {
                const t = p.time as number;
                byTime.set(t, p);
            }
            return Array.from(byTime.values()).sort((a, b) => (a.time as number) - (b.time as number));
        },
        []
    );

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current || !visible) return;

        const chart = createChart(containerRef.current, {
            width: Math.max(containerRef.current.clientWidth, 1),
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
            rightPriceScale: {
                borderColor: "#374151",
                scaleMargins: { top: 0.2, bottom: 0.2 },
            },
            timeScale: {
                borderColor: "#374151",
                visible: false, // Hide time scale, sync with main chart
            },
            crosshair: {
                mode: 1, // Hidden
            },
        });

        // Add line series (v5 API)
        const series = chart.addSeries(LineSeries, {
            color: "#8b5cf6",
            lineWidth: 2,
            priceLineVisible: false,
            lastValueVisible: true,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
        });

        // Add zero line
        series.createPriceLine({
            price: 0,
            color: "#6b7280",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: false,
        });

        chartRef.current = chart;
        seriesRef.current = series;
        setIsChartReady(true);

        const syncChartSize = () => {
            if (containerRef.current) {
                const width = containerRef.current.clientWidth;
                if (width > 0) {
                    chart.applyOptions({ width, height });
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

        return () => {
            window.removeEventListener("resize", handleResize);
            window.clearTimeout(timeoutId);
            cancelAnimationFrame(rafId);
            resizeObserver?.disconnect();
            chart.remove();
            chartRef.current = null;
            seriesRef.current = null;
            setIsChartReady(false);
        };
    }, [height, visible]);

    // Update chart data
    useEffect(() => {
        if (!seriesRef.current || !isChartReady || data.length === 0) return;

        const profitData = calculateProfitTimeline(data, trade);
        seriesRef.current.setData(profitData);

        chartRef.current?.timeScale().fitContent();
    }, [data, trade, isChartReady, calculateProfitTimeline]);

    // Add MAE/MFE price lines (remove old before adding new to avoid accumulation)
    useEffect(() => {
        if (!seriesRef.current || !isChartReady) return;

        const series = seriesRef.current;

        // Remove existing MAE/MFE lines
        if (maeLineRef.current) {
            series.removePriceLine(maeLineRef.current);
            maeLineRef.current = null;
        }
        if (mfeLineRef.current) {
            series.removePriceLine(mfeLineRef.current);
            mfeLineRef.current = null;
        }

        if (showMAE && mae) {
            const maeStr = mae.profit >= 0 ? `$${mae.profit.toFixed(2)}` : `-$${Math.abs(mae.profit).toFixed(2)}`;
            maeLineRef.current = series.createPriceLine({
                price: mae.profit,
                color: "#ef4444",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `MAE: ${maeStr}`,
            });
        }

        if (showMFE && mfe) {
            const mfeStr = mfe.profit >= 0 ? `$${mfe.profit.toFixed(2)}` : `-$${Math.abs(mfe.profit).toFixed(2)}`;
            mfeLineRef.current = series.createPriceLine({
                price: mfe.profit,
                color: "#22c55e",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `MFE: ${mfeStr}`,
            });
        }
    }, [isChartReady, showMAE, showMFE, mae, mfe]);

    useImperativeHandle(ref, () => ({
        fitContent: () => {
            chartRef.current?.timeScale().fitContent();
        },
    }), []);

    if (!visible) return null;

    return (
        <div className="relative w-full" style={{ height }}>
            {/* Header with MAE/MFE values (dollar amounts) */}
            <div className="absolute left-2 top-1 z-10 flex items-center gap-4 text-xs">
                <span className="text-gray-500">Floating P&L</span>
                {showMAE && mae && (
                    <span className="text-red-400">
                        MAE: {mae.profit >= 0 ? `$${mae.profit.toFixed(2)}` : `-$${Math.abs(mae.profit).toFixed(2)}`}
                    </span>
                )}
                {showMFE && mfe && (
                    <span className="text-green-400">
                        MFE: {mfe.profit >= 0 ? `$${mfe.profit.toFixed(2)}` : `-$${Math.abs(mfe.profit).toFixed(2)}`}
                    </span>
                )}
            </div>
            <div
                ref={containerRef}
                className="w-full rounded-lg bg-gray-900/30"
                style={{ height }}
            />
        </div>
    );
});
