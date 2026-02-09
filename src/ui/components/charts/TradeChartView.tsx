"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { Trade, ChartTimeframe } from "@domain/entities";
import { Direction } from "@domain/enums";
import { X } from "lucide-react";
import { formatPipsLabel } from "@lib/pnl-estimate";
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
    initialTimeframe = "M1",
    accessToken,
    chartHeight = 400,
    profitTimelineHeight = 200,
}: TradeChartViewProps) {
    const [timeframe, setTimeframe] = useState<ChartTimeframe>(initialTimeframe);
    const [showProfitTimeline, setShowProfitTimeline] = useState(true);
    const [showMAE, setShowMAE] = useState(true);
    const [showMFE, setShowMFE] = useState(true);
    const [isExpanded, setIsExpanded] = useState(false);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const candlestickChartRef = useRef<{ fitContent: () => void } | null>(null);
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

    // Reset view - switch to M1, scroll to trade, fit charts (delay to allow M1 data to load)
    const handleResetView = useCallback(() => {
        setTimeframe("M1");
        setTimeout(() => {
            candlestickChartRef.current?.scrollToTrade?.();
            candlestickChartRef.current?.fitContent();
            profitChartRef.current?.fitContent();
        }, 150);
    }, []);

    // RR summary for trade panel (entry, risk, target, profit)
    const rrSummary = useMemo(() => {
        const entry = trade.entryPrice ?? trade.openPrice;
        const exit = trade.closePrice ?? trade.takeProfit;
        const sl = trade.stopLoss;
        const isBuy = trade.direction === Direction.Buy;
        const symbol = trade.symbol ?? "";

        const openTs = new Date(trade.openTime).getTime();
        const closeTs = trade.closeTime
            ? new Date(trade.closeTime).getTime()
            : (data.length > 0 ? Math.max(...data.map((b) => b.timestamp)) : openTs + 86400000);
        const tradeBars = data.filter((b) => b.timestamp >= openTs && b.timestamp <= closeTs);

        const mae = tradeBars.length > 0
            ? (isBuy ? Math.min(...tradeBars.map((b) => b.low)) : Math.max(...tradeBars.map((b) => b.high)))
            : null;

        const useMae = sl == null || sl === undefined;
        const riskPrice = useMae ? mae : sl;

        const riskLabel =
            entry != null && riskPrice != null
                ? formatPipsLabel(isBuy ? riskPrice - entry : entry - riskPrice, symbol)
                : null;

        const targetLabel =
            entry != null && exit != null
                ? formatPipsLabel(isBuy ? exit - entry : entry - exit, symbol)
                : null;

        const netProfit = trade.netProfit ?? trade.grossProfit;
        const profitStr =
            netProfit != null && Number.isFinite(netProfit)
                ? `${netProfit >= 0 ? "+" : ""}$${netProfit.toFixed(2)}`
                : null;

        return {
            entry,
            exit,
            riskLabel,
            targetLabel,
            profitStr,
            useMae,
            direction: trade.direction,
        };
    }, [trade, data]);

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

    const chartContent = (
        <>
            <div className="flex flex-nowrap items-center justify-between gap-3 overflow-x-auto">
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
                    isExpanded={isExpanded}
                    onToggleExpand={() => setIsExpanded((prev) => !prev)}
                    disabled={isLoading}
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
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs">
                <div className="flex items-center gap-2">
                    <span className="text-gray-500">Symbol</span>
                    <span className="font-medium text-gray-300">{trade.symbol}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-500">Dir</span>
                    <span
                        className={`font-medium ${rrSummary.direction === "Buy" ? "text-green-400" : "text-red-400"}`}
                    >
                        {rrSummary.direction}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-gray-500">Entry</span>
                    <span className="font-mono text-gray-300">
                        {rrSummary.entry != null ? rrSummary.entry.toFixed(5) : "—"}
                    </span>
                </div>
                {rrSummary.riskLabel != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">{rrSummary.useMae ? "MAE" : "SL"}</span>
                        <span className="font-mono text-red-400">{rrSummary.riskLabel}</span>
                    </div>
                )}
                {rrSummary.targetLabel != null && (
                    <div className="flex items-center gap-2">
                        <span className="text-gray-500">{trade.closePrice ? "Exit" : "Target"}</span>
                        <span className="font-mono text-green-400">{rrSummary.targetLabel}</span>
                    </div>
                )}
                {rrSummary.profitStr != null && (
                    <div className="flex items-center gap-2 ml-auto">
                        <span className="text-gray-500">Profit</span>
                        <span
                            className={`font-semibold ${rrSummary.profitStr.startsWith("+") ? "text-green-400" : "text-red-400"}`}
                        >
                            {rrSummary.profitStr}
                        </span>
                    </div>
                )}
            </div>
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
                    className="fixed inset-4 z-50 flex flex-col gap-4 rounded-xl bg-gray-950 p-6 shadow-2xl"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Expanded chart"
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-lg font-medium text-gray-200">
                            {trade.symbol} – {trade.direction}
                        </h3>
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="flex items-center gap-2 rounded-lg bg-gray-800 px-4 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
                            title="Collapse"
                        >
                            <X className="h-5 w-5" />
                            Close
                        </button>
                    </div>
                    <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-auto">
                        {chartContent}
                    </div>
                </div>
            </>
        );
    }

    return (
        <div
            ref={chartContainerRef}
            className="flex flex-col gap-4 rounded-xl bg-gray-950/50 p-4"
        >
            {chartContent}
        </div>
    );
}
