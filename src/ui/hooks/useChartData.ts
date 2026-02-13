"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { Trade, ChartTimeframe, ChartBar } from "@domain/entities";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { CTraderAPI } from "@infrastructure/api/ctrader";
import { LoadChartWindowUseCase } from "@application/use-cases/charts";

export interface UseChartDataOptions {
    /** Trade to fetch chart data for */
    trade: Trade;
    /** Chart timeframe */
    timeframe: ChartTimeframe;
    /** Access token for API calls (optional) */
    accessToken?: string;
    /** Window size in days (default: 2) */
    windowDays?: number;
    /** Whether to enable the query */
    enabled?: boolean;
    /** Broker identifier for broker-based queries (optional, improves query performance) */
    broker?: string;
}

export interface UseChartDataResult {
    /** Chart bar data */
    data: ChartBar[];
    /** Loading state */
    isLoading: boolean;
    /** Error if any */
    error: Error | null;
    /** Whether data came from cache */
    fromCache: boolean;
    /** Refetch function */
    refetch: () => Promise<void>;
    /** Fetch earlier data (for lazy loading) */
    fetchPrevious: () => Promise<void>;
    /** Fetch later data (for lazy loading) */
    fetchNext: () => Promise<void>;
    /** Window boundaries */
    windowStart: number;
    windowEnd: number;
}

// Memory cap for chart bars
const MAX_BARS = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeBars(bars: ChartBar[]): ChartBar[] {
    if (bars.length === 0) return [];

    const sorted = [...bars].sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return (a.id ?? 0) - (b.id ?? 0);
    });

    const byTimestamp = new Map<number, ChartBar>();
    for (const bar of sorted) {
        // Keep the latest encountered bar for duplicate timestamps.
        byTimestamp.set(bar.timestamp, bar);
    }

    return Array.from(byTimestamp.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function capBars(bars: ChartBar[], mode: "earliest" | "recent"): ChartBar[] {
    if (bars.length <= MAX_BARS) return bars;
    return mode === "recent" ? bars.slice(-MAX_BARS) : bars.slice(0, MAX_BARS);
}

/**
 * useChartData - Hook for fetching and caching chart data
 *
 * Implements cache-first loading with lazy loading support.
 */
export function useChartData({
    trade,
    timeframe,
    accessToken,
    windowDays = 2,
    enabled = true,
    broker,
}: UseChartDataOptions): UseChartDataResult {
    const [data, setData] = useState<ChartBar[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [fromCache, setFromCache] = useState(false);
    const [windowStart, setWindowStart] = useState(0);
    const [windowEnd, setWindowEnd] = useState(0);
    const lazyFetchDirectionRef = useRef<"prev" | "next" | null>(null);
    const activeSeriesKeyRef = useRef("");
    const currentSeriesKey = `${broker ?? ""}|${trade.symbol}|${timeframe}`;

    useEffect(() => {
        activeSeriesKeyRef.current = currentSeriesKey;
        lazyFetchDirectionRef.current = null;
    }, [currentSeriesKey]);

    // Create use case with dependencies
    const useCase = useMemo(() => {
        const chartBarRepository = new DexieChartBarRepository();
        const api = new CTraderAPI();
        return new LoadChartWindowUseCase(api, chartBarRepository);
    }, []);

    // Fetch chart data
    const fetchData = useCallback(async () => {
        if (!enabled || !trade) return;

        setIsLoading(true);
        setError(null);

        try {
            const result = await useCase.execute({
                trade,
                timeframe,
                accessToken,
                windowDays,
                broker,
            });

            const normalizedBars = normalizeBars(result.bars);
            // On initial load, keep the most recent segment.
            const cappedBars = capBars(normalizedBars, "recent");

            setData(cappedBars);
            setFromCache(result.fromCache);
            setWindowStart(cappedBars[0]?.timestamp ?? result.windowStart);
            setWindowEnd(cappedBars[cappedBars.length - 1]?.timestamp ?? result.windowEnd);
        } catch (err) {
            setError(err instanceof Error ? err : new Error("Failed to load chart data"));
            setData([]);
        } finally {
            setIsLoading(false);
        }
    }, [enabled, trade, timeframe, accessToken, windowDays, broker, useCase]);

    // Fetch data on mount and when dependencies change
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Lazy loading: fetch previous chunk
    const fetchPrevious = useCallback(async () => {
        if (windowStart <= 0 || isLoading || lazyFetchDirectionRef.current) return;

        const newWindowStart = Math.max(0, windowStart - windowDays * DAY_MS);
        if (newWindowStart === windowStart) return;

        const requestKey = activeSeriesKeyRef.current;
        lazyFetchDirectionRef.current = "prev";
        try {
            const chartBarRepository = new DexieChartBarRepository();
            const queryTo = Math.max(newWindowStart, windowStart - 1);
            const previousBars = await chartBarRepository.getByWindow(
                trade.symbol,
                timeframe,
                newWindowStart,
                queryTo,
                broker
            );
            if (activeSeriesKeyRef.current !== requestKey) return;

            const normalizedPreviousBars = normalizeBars(previousBars);
            if (normalizedPreviousBars.length > 0) {
                setData((prev) => {
                    const earliest = prev[0]?.timestamp ?? Number.POSITIVE_INFINITY;
                    const olderBars = normalizedPreviousBars.filter((bar) => bar.timestamp < earliest);
                    if (olderBars.length === 0) return prev;

                    const merged = normalizeBars([...olderBars, ...prev]);
                    if (merged.length <= MAX_BARS) {
                        return merged;
                    }

                    // Keep earliest bars when paging left.
                    const capped = capBars(merged, "earliest");
                    const newEnd = capped[capped.length - 1]?.timestamp;
                    if (newEnd != null) {
                        setWindowEnd(newEnd);
                    }
                    return capped;
                });
            }

            // Always advance window start so history paging can move through empty gaps.
            setWindowStart(newWindowStart);
        } catch (err) {
            console.error("Failed to fetch previous data:", err);
        } finally {
            if (lazyFetchDirectionRef.current === "prev") {
                lazyFetchDirectionRef.current = null;
            }
        }
    }, [windowStart, isLoading, trade.symbol, timeframe, windowDays, broker]);

    // Lazy loading: fetch next chunk
    const fetchNext = useCallback(async () => {
        if (windowEnd === 0 || isLoading || lazyFetchDirectionRef.current) return;

        const newWindowEnd = windowEnd + windowDays * DAY_MS;

        const requestKey = activeSeriesKeyRef.current;
        lazyFetchDirectionRef.current = "next";
        try {
            const chartBarRepository = new DexieChartBarRepository();
            const queryFrom = windowEnd + 1;
            const nextBars = await chartBarRepository.getByWindow(
                trade.symbol,
                timeframe,
                queryFrom,
                newWindowEnd,
                broker
            );
            if (activeSeriesKeyRef.current !== requestKey) return;

            const normalizedNextBars = normalizeBars(nextBars);
            if (normalizedNextBars.length > 0) {
                setData((prev) => {
                    const latest = prev[prev.length - 1]?.timestamp ?? Number.NEGATIVE_INFINITY;
                    const newerBars = normalizedNextBars.filter((bar) => bar.timestamp > latest);
                    if (newerBars.length === 0) return prev;

                    const merged = normalizeBars([...prev, ...newerBars]);
                    if (merged.length <= MAX_BARS) {
                        return merged;
                    }

                    // Keep most recent bars when paging right.
                    const capped = capBars(merged, "recent");
                    const newStart = capped[0]?.timestamp;
                    if (newStart != null) {
                        setWindowStart(newStart);
                    }
                    return capped;
                });
            }

            // Always advance window end so forward paging can move through empty gaps.
            setWindowEnd(newWindowEnd);
        } catch (err) {
            console.error("Failed to fetch next data:", err);
        } finally {
            if (lazyFetchDirectionRef.current === "next") {
                lazyFetchDirectionRef.current = null;
            }
        }
    }, [windowEnd, isLoading, trade.symbol, timeframe, windowDays, broker]);

    return {
        data,
        isLoading,
        error,
        fromCache,
        refetch: fetchData,
        fetchPrevious,
        fetchNext,
        windowStart,
        windowEnd,
    };
}
