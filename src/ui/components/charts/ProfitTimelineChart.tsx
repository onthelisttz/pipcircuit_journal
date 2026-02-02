"use client";

import {
    createChart,
    type IChartApi,
    type ISeriesApi,
    type LineData,
    type Time,
    ColorType,
    LineStyle,
    LineSeries,
} from "lightweight-charts";
import { useEffect, useRef, useCallback, useState } from "react";
import type { ChartBar, Trade } from "@domain/entities";
import { Direction } from "@domain/enums";

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

interface ProfitPoint {
    time: number;
    profit: number;
}

/**
 * ProfitTimelineChart - Floating P&L visualization during trade
 *
 * Shows profit/loss evolution during trade duration with MAE/MFE markers.
 */
export function ProfitTimelineChart({
    data,
    trade,
    height = 120,
    visible = true,
    showMAE = true,
    showMFE = true,
}: ProfitTimelineChartProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);
    const [isChartReady, setIsChartReady] = useState(false);
    const [mae, setMae] = useState<ProfitPoint | null>(null);
    const [mfe, setMfe] = useState<ProfitPoint | null>(null);

    // Calculate floating P&L for each bar within trade duration
    const calculateProfitTimeline = useCallback(
        (bars: ChartBar[], tradeData: Trade): LineData<Time>[] => {
            if (!tradeData.openTime || !tradeData.openPrice) return [];

            const isBuy = tradeData.direction === Direction.Buy;
            const openTime = tradeData.openTime.getTime();
            const closeTime = tradeData.closeTime?.getTime() ?? Date.now();
            const openPrice = tradeData.openPrice;
            const volume = tradeData.volume ?? 1;

            // Filter bars within trade duration
            const tradeBars = bars.filter(
                (bar) => bar.timestamp >= openTime && bar.timestamp <= closeTime
            );

            let minProfit: ProfitPoint | null = null;
            let maxProfit: ProfitPoint | null = null;

            const profitData = tradeBars.map((bar) => {
                // Calculate floating P&L based on close price of bar
                const priceDiff = isBuy ? bar.close - openPrice : openPrice - bar.close;
                const profit = priceDiff * volume * 100000; // Simplified pip value calculation

                // Track MAE (Maximum Adverse Excursion)
                if (minProfit === null || profit < minProfit.profit) {
                    minProfit = { time: bar.timestamp, profit };
                }

                // Track MFE (Maximum Favorable Excursion)
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

            return profitData;
        },
        []
    );

    // Initialize chart
    useEffect(() => {
        if (!containerRef.current || !visible) return;

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
            rightPriceScale: {
                borderColor: "#374151",
                scaleMargins: { top: 0.2, bottom: 0.2 },
            },
            timeScale: {
                borderColor: "#374151",
                visible: false, // Hide time scale, sync with main chart
            },
            crosshair: {
                mode: 0, // Hidden
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

        return () => {
            window.removeEventListener("resize", handleResize);
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

    // Add MAE/MFE price lines
    useEffect(() => {
        if (!seriesRef.current || !isChartReady) return;

        // Create MAE price line if visible and available
        if (showMAE && mae) {
            seriesRef.current.createPriceLine({
                price: mae.profit,
                color: "#ef4444",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `MAE: ${mae.profit.toFixed(2)}`,
            });
        }

        // Create MFE price line if visible and available
        if (showMFE && mfe) {
            seriesRef.current.createPriceLine({
                price: mfe.profit,
                color: "#22c55e",
                lineWidth: 1,
                lineStyle: LineStyle.Dotted,
                axisLabelVisible: true,
                title: `MFE: ${mfe.profit.toFixed(2)}`,
            });
        }
    }, [isChartReady, showMAE, showMFE, mae, mfe]);

    if (!visible) return null;

    return (
        <div className="relative w-full" style={{ height }}>
            {/* Header with MAE/MFE values */}
            <div className="absolute left-2 top-1 z-10 flex items-center gap-4 text-xs">
                <span className="text-gray-500">Floating P&L</span>
                {showMAE && mae && (
                    <span className="text-red-400">MAE: {mae.profit.toFixed(2)}</span>
                )}
                {showMFE && mfe && (
                    <span className="text-green-400">MFE: {mfe.profit.toFixed(2)}</span>
                )}
            </div>
            <div
                ref={containerRef}
                className="w-full rounded-lg bg-gray-900/30"
                style={{ height }}
            />
        </div>
    );
}
