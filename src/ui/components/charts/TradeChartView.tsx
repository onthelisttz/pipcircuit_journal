"use client";

import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { Trade, ChartTimeframe } from "@domain/entities";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { TradeCandlestickChart } from "./TradeCandlestickChart";
import { ProfitTimelineChart } from "./ProfitTimelineChart";
import { TimeframeSelector } from "./TimeframeSelector";
import { ChartControls } from "./ChartControls";
import { useChartData } from "@ui/hooks/useChartData";
import type { DrawingToolType, TradeCandlestickChartRef } from "./TradeCandlestickChart";
import { TradePositionInput } from "@ui/components/common/TradePositionInput";
import { volumeToLots } from "@lib/pnl-estimate";
import { hexToRgba } from "@lib/color";
import { TimeGuidesControls } from "./TimeGuidesControls";
import {
    readStoredTimeGuideSettings,
    type TimeGuideSettings,
} from "./timeGuides";

const TRADE_CHART_TIME_GUIDES_KEY = "tradeChartTimeGuides";
const CHART_CONTINUOUS_DRAWING_KEY = "chartContinuousDrawingEnabled_v1";
const CTRADER_CHART_DISPLAY_OFFSET_MS = 3 * 60 * 60 * 1000;

function formatProfit(value: number): string {
    const sign = value >= 0 ? "+" : "-";
    return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function formatHeaderDate(value: Date | number | string | undefined): string {
    if (!value) return "-";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("en-GB", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
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
    /** Jump directly to a 1-based trade position */
    onGoToTradePosition?: (position: number) => void;
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
    onGoToTradePosition,
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
    const [continuousDrawingEnabled, setContinuousDrawingEnabled] = useState(() => {
        if (typeof window === "undefined") return false;
        return window.localStorage.getItem(CHART_CONTINUOUS_DRAWING_KEY) === "true";
    });
    const [rectangleFillColor, setRectangleFillColor] = useState("#8b5cf6");
    const [rectangleFillOpacity, setRectangleFillOpacity] = useState(0.2);
    const [selectedDrawingTool, setSelectedDrawingTool] = useState<DrawingToolType | null>(null);
    const [calloutText, setCalloutText] = useState("Text");
    const [calloutFontSize, setCalloutFontSize] = useState(18);
    const [calloutTextColor, setCalloutTextColor] = useState("#00ff66");
    const [calloutLineColor, setCalloutLineColor] = useState("#00ff66");
    const [calloutBoxColor, setCalloutBoxColor] = useState("rgba(0,0,0,0.88)");
    const [timeGuides, setTimeGuides] = useState<TimeGuideSettings>(() =>
        readStoredTimeGuideSettings(TRADE_CHART_TIME_GUIDES_KEY)
    );
    const initialLots = useMemo(() => {
        if (trade.lots != null && Number.isFinite(trade.lots)) return trade.lots;
        const derived = volumeToLots(trade.volume ?? 0, trade.symbol ?? "");
        return Number.isFinite(derived) && derived > 0 ? derived : 1;
    }, [trade.lots, trade.volume, trade.symbol]);
    const [longShortLots, setLongShortLots] = useState<number>(initialLots);
    const [viewportHeight, setViewportHeight] = useState(900);
    const [visualAreaHeight, setVisualAreaHeight] = useState(0);
    const chartContainerRef = useRef<HTMLDivElement>(null);
    const visualAreaRef = useRef<HTMLDivElement>(null);
    const candlestickChartRef = useRef<TradeCandlestickChartRef | null>(null);
    const calloutTextInputRef = useRef<HTMLTextAreaElement>(null);
    const profitChartRef = useRef<{ fitContent: () => void } | null>(null);
    const skipNextCalloutApplyRef = useRef(false);
    const pendingTradeCenterRef = useRef(true);
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
    const { data, dataUpdateMode, isLoading, error, refetch } = useChartData({
        trade,
        timeframe,
        accessToken,
        broker,
    });
    const displayData = useMemo(
        () =>
            data.map((bar) => ({
                ...bar,
                timestamp: bar.timestamp + CTRADER_CHART_DISPLAY_OFFSET_MS,
            })),
        [data]
    );
    const displayTrade = useMemo<Trade>(() => ({
        ...trade,
        openTime: new Date(
            (trade.openTime instanceof Date ? trade.openTime.getTime() : new Date(trade.openTime).getTime()) +
                CTRADER_CHART_DISPLAY_OFFSET_MS
        ),
        closeTime: trade.closeTime
            ? new Date(
                (trade.closeTime instanceof Date
                    ? trade.closeTime.getTime()
                    : new Date(trade.closeTime).getTime()) + CTRADER_CHART_DISPLAY_OFFSET_MS
            )
            : null,
    }), [trade]);

    // Handle timeframe change
    const handleTimeframeChange = useCallback((newTimeframe: ChartTimeframe) => {
        pendingTradeCenterRef.current = true;
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
    const headerPnlClass =
        headerPnl > 0 ? "text-emerald-400" : headerPnl < 0 ? "text-red-400" : "text-muted-foreground";
    const headerDate = trade.openTime;
    const drawingFillRgba = useMemo(
        () => hexToRgba(rectangleFillColor, rectangleFillOpacity),
        [rectangleFillColor, rectangleFillOpacity]
    );

    useEffect(() => {
        if (selectedDrawingTool !== "Callout") return;
        const config = candlestickChartRef.current?.getSelectedCalloutConfig();
        if (!config) return;
        skipNextCalloutApplyRef.current = true;
        setCalloutText(config.text || "Text");
        setCalloutFontSize(config.fontSize || 18);
        setCalloutTextColor(config.textColor || "#00ff66");
        setCalloutLineColor(config.lineColor || "#00ff66");
        setCalloutBoxColor(config.boxColor || "rgba(0,0,0,0.88)");
    }, [selectedDrawingTool]);

    useEffect(() => {
        if (selectedDrawingTool !== "Callout") return;
        if (skipNextCalloutApplyRef.current) {
            skipNextCalloutApplyRef.current = false;
            return;
        }
        candlestickChartRef.current?.updateSelectedCallout({
            text: calloutText,
            fontSize: calloutFontSize,
            textColor: calloutTextColor,
            lineColor: calloutLineColor,
            boxColor: calloutBoxColor,
        });
    }, [calloutBoxColor, calloutFontSize, calloutLineColor, calloutText, calloutTextColor, selectedDrawingTool]);

    const handleCalloutTextKeyDown = useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== "Enter") return;
        if (event.shiftKey) return;
        event.preventDefault();
        event.currentTarget.blur();
    }, []);

    useEffect(() => {
        setLongShortLots(initialLots);
    }, [initialLots, trade.id]);

    useEffect(() => {
        pendingTradeCenterRef.current = true;
    }, [trade.id, trade.openTime, trade.closeTime]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(TRADE_CHART_TIME_GUIDES_KEY, JSON.stringify(timeGuides));
    }, [timeGuides]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        window.localStorage.setItem(
            CHART_CONTINUOUS_DRAWING_KEY,
            continuousDrawingEnabled ? "true" : "false"
        );
    }, [continuousDrawingEnabled]);

    // Reset view - switch to M1, scroll to trade, fit charts, remove all drawing tools (delay to allow M1 data to load)
    const handleResetView = useCallback(() => {
        if (showsCandlestick) {
            // Remove drawing tools immediately when candlestick chart is visible.
            candlestickChartRef.current?.removeAllDrawingTools();
            setDrawingTool(null);
            setSelectedDrawingTool(null);
        }

        pendingTradeCenterRef.current = true;
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
        if (!showsCandlestick) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            const target = event.target as HTMLElement | null;
            if (
                target?.tagName === "INPUT" ||
                target?.tagName === "TEXTAREA" ||
                target?.isContentEditable
            ) {
                return;
            }
            const key = event.key.toLowerCase();
            const toggleTool = (tool: DrawingToolType) => {
                setDrawingTool((current) => (current === tool ? null : tool));
            };
            if (key === "t") {
                event.preventDefault();
                toggleTool("TrendLine");
            }
            if (key === "r") {
                event.preventDefault();
                toggleTool("Rectangle");
            }
            if (key === "b") {
                event.preventDefault();
                toggleTool("Brush");
            }
            if (key === "h") {
                event.preventDefault();
                toggleTool("HorizontalRay");
            }
            if (key === "p") {
                event.preventDefault();
                toggleTool("Path");
            }
            if (key === "m" || key === "x") {
                event.preventDefault();
                toggleTool("Callout");
            }
            if (key === "s" || key === "l") {
                event.preventDefault();
                toggleTool("LongShortPosition");
            }
        };

        window.addEventListener("keydown", handleKeyDown, true);
        return () => window.removeEventListener("keydown", handleKeyDown, true);
    }, [showsCandlestick]);

    useEffect(() => {
        if (!showsCandlestick || !trade || isLoading || displayData.length === 0) return;
        if (!pendingTradeCenterRef.current) return;

        pendingTradeCenterRef.current = false;
        const timer = window.setTimeout(() => {
            candlestickChartRef.current?.scrollToTrade(activeZoomOutMultiplier);
        }, 80);

        return () => {
            window.clearTimeout(timer);
        };
    }, [activeZoomOutMultiplier, displayData.length, isLoading, showsCandlestick, trade]);

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
                className={`z-30 -mx-2 -mt-2 flex flex-nowrap items-center gap-2 overflow-visible border-b border-border/70 bg-card px-2 py-1.5 ${
                    hideTimeframeInToolbar ? "justify-end" : "justify-between"
                }`}
            >
                {!hideTimeframeInToolbar && (
                    <div className="flex items-center gap-2">
                        <TimeframeSelector
                            value={timeframe}
                            onChange={handleTimeframeChange}
                            disabled={isLoading}
                        />
                    </div>
                )}
                {showsCandlestick && (
                    <div className="flex flex-nowrap items-center gap-2 overflow-x-auto">
                        <TimeGuidesControls
                            value={timeGuides}
                            onChange={setTimeGuides}
                            disabled={isLoading}
                            compact
                        />
                        {(() => {
                            const showDrawControls =
                                drawingTool === "Brush" ||
                                drawingTool === "Gan" ||
                                drawingTool === "Rectangle" ||
                                drawingTool === "TrendLine" ||
                                drawingTool === "HorizontalRay" ||
                                drawingTool === "Path" ||
                                selectedDrawingTool === "Brush" ||
                                selectedDrawingTool === "Gan" ||
                                selectedDrawingTool === "Rectangle" ||
                                selectedDrawingTool === "TrendLine" ||
                                selectedDrawingTool === "HorizontalRay" ||
                                selectedDrawingTool === "Path";
                            const showCalloutControls =
                                drawingTool === "Callout" ||
                                selectedDrawingTool === "Callout";
                            const showLotsControls =
                                drawingTool === "LongShortPosition" ||
                                selectedDrawingTool === "LongShortPosition";

                            return (
                                <>
                                    {showDrawControls ? (
                                        <div className="flex h-7 items-center gap-1.5 rounded-md border border-border px-1.5 py-0.5">
                                         
                                            <input
                                                type="color"
                                                aria-label="Draw color"
                                                value={rectangleFillColor}
                                                onChange={(event) => setRectangleFillColor(event.target.value)}
                                                className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                                            />
                                            <input
                                                type="range"
                                                aria-label="Draw opacity"
                                                min={0}
                                                max={1}
                                                step={0.05}
                                                value={rectangleFillOpacity}
                                                onChange={(event) => setRectangleFillOpacity(Number(event.target.value))}
                                                className="h-1.5 w-14 accent-foreground"
                                            />
                                        </div>
                                    ) : null}
                                    <label className="flex h-7 items-center gap-2 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={continuousDrawingEnabled}
                                            onChange={(event) => setContinuousDrawingEnabled(event.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-border accent-primary"
                                        />
                                        <span className="whitespace-nowrap font-medium">Cts draw</span>
                                    </label>
                                    {showLotsControls ? (
                                        <div className="flex h-7 items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
                                            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                                                Lots
                                            </span>
                                            <input
                                                type="number"
                                                inputMode="decimal"
                                                min={0.01}
                                                step={0.01}
                                                value={Number.isFinite(longShortLots) ? longShortLots : 1}
                                                onChange={(event) => setLongShortLots(Number(event.target.value))}
                                                className="h-5 w-14 rounded border border-border bg-background px-1.5 text-[10px] text-foreground"
                                            />
                                        </div>
                                    ) : null}
                                    {showCalloutControls ? (
                                        <div className="flex h-7 min-w-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5">
                                            <textarea
                                                ref={calloutTextInputRef}
                                                value={calloutText}
                                                onChange={(event) => setCalloutText(event.target.value)}
                                                onKeyDown={handleCalloutTextKeyDown}
                                                placeholder="Text"
                                                rows={1}
                                                className="h-7 w-20 resize-none rounded border border-border bg-background px-1 py-1 text-[10px] leading-[1.2] text-foreground"
                                            />
                                            <input
                                                type="color"
                                                value={calloutTextColor}
                                                onChange={(event) => setCalloutTextColor(event.target.value)}
                                                className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                                                aria-label="Text color"
                                            />
                                            <input
                                                type="color"
                                                value={calloutLineColor}
                                                onChange={(event) => setCalloutLineColor(event.target.value)}
                                                className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                                                aria-label="Line and border color"
                                            />
                                            <input
                                                type="color"
                                                value={calloutBoxColor}
                                                onChange={(event) => setCalloutBoxColor(event.target.value)}
                                                className="h-4 w-4 cursor-pointer rounded border border-border bg-transparent p-0"
                                                aria-label="Box color"
                                            />
                                            <input
                                                type="number"
                                                min={10}
                                                max={48}
                                                step={1}
                                                value={calloutFontSize}
                                                onChange={(event) =>
                                                    setCalloutFontSize(
                                                        Math.max(10, Math.min(48, Number(event.target.value) || 18))
                                                    )
                                                }
                                                className="h-5 w-12 rounded border border-border bg-background px-1 text-[10px] text-foreground"
                                                aria-label="Font size"
                                            />
                                        </div>
                                    ) : null}
                                </>
                            );
                        })()}
                    </div>
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
                    rectangleFillColor={rectangleFillColor}
                    rectangleFillOpacity={rectangleFillOpacity}
                    drawingSelection={selectedDrawingTool}
                    longShortLots={longShortLots}
                    onLongShortLotsChange={setLongShortLots}
                    onRectangleFillColorChange={setRectangleFillColor}
                    onRectangleFillOpacityChange={setRectangleFillOpacity}
                    continuousDrawingEnabled={continuousDrawingEnabled}
                    onContinuousDrawingChange={setContinuousDrawingEnabled}
                    showDrawExtras={false}
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
                        data={displayData}
                        timeframe={timeframe}
                        timeGuides={timeGuides}
                        clipTimeGuideOverlayToPane
                        trade={displayTrade}
                        dataUpdateMode={dataUpdateMode}
                        height={resolvedChartHeight}
                        zoomOutMultiplier={activeZoomOutMultiplier}
                        showEntryMarker={true}
                        showExitMarker={true}
                        onVisibleRangeChange={handleVisibleRangeChange}
                        autoScrollOnData={false}
                        isLoading={isLoading}
                        drawingTool={drawingTool}
                        continuousDrawing={continuousDrawingEnabled}
                        drawingLineColor={rectangleFillColor}
                        rectangleFillColor={drawingFillRgba}
                        rectangleBorderColor={rectangleFillColor}
                        calloutText={calloutText}
                        calloutFontSize={calloutFontSize}
                        calloutTextColor={calloutTextColor}
                        calloutLineColor={calloutLineColor}
                        calloutBoxColor={calloutBoxColor}
                        onDrawingSelectionChange={setSelectedDrawingTool}
                        onDrawingToolComplete={() => {
                            if (!continuousDrawingEnabled) {
                                setDrawingTool(null);
                            }
                        }}
                        onDrawingToolCancel={() => {
                            setDrawingTool(null);
                            setSelectedDrawingTool(null);
                        }}
                        onCalloutEditRequest={() => {
                            window.setTimeout(() => {
                                calloutTextInputRef.current?.focus();
                                calloutTextInputRef.current?.select();
                            }, 0);
                        }}
                        longShortLots={longShortLots}
                        longShortSymbol={trade.symbol ?? ""}
                        showRiskReward={showRiskReward}
                        showRiskRewardLabels={showRiskRewardLabels}
                    />
                )}
                {showProfitTimeline && (
                    <ProfitTimelineChart
                        ref={profitChartRef}
                        data={displayData}
                        trade={displayTrade}
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
                                {headerLots.toFixed(2)} lots |{" "}
                                <span className={`font-medium ${headerPnlClass}`}>
                                    {formatProfit(headerPnl)}
                                </span>{" "}
                                | {formatHeaderDate(headerDate)}
                            </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                            {(onPrevTrade || onNextTrade) && (
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={onPrevTrade}
                                        disabled={!onPrevTrade || !canPrevTrade}
                                        className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 sm:gap-1"
                                        title="Previous trade (PageUp or ArrowLeft)"
                                        aria-label="Previous trade (PageUp or ArrowLeft)"
                                    >
                                        <ChevronLeft className="h-3.5 w-3.5" />
                                        <span className="hidden sm:inline">Back</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onNextTrade}
                                        disabled={!onNextTrade || !canNextTrade}
                                        className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 sm:gap-1"
                                        title="Next trade (PageDown or ArrowRight)"
                                        aria-label="Next trade (PageDown or ArrowRight)"
                                    >
                                        <span className="hidden sm:inline">Next</span>
                                        <ChevronRight className="h-3.5 w-3.5" />
                                    </button>
                                    {typeof currentTradePosition === "number" &&
                                        typeof totalTrades === "number" &&
                                        totalTrades > 0 && (
                                            <TradePositionInput
                                                current={currentTradePosition}
                                                total={totalTrades}
                                                onChangePosition={onGoToTradePosition ?? (() => undefined)}
                                                separator="of"
                                                wrapperClassName="ml-1 text-[11px]"
                                                inputClassName="h-6 text-[11px]"
                                                textClassName="text-muted-foreground"
                                                ariaLabel="Go to trade in chart view"
                                            />
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
