"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { Trade, ChartTimeframe, ChartBar } from "@domain/entities";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { SupabaseChartBarRepository } from "@infrastructure/db/supabase/repositories";
import { CTraderAPI } from "@infrastructure/api/ctrader";
import { LoadChartWindowUseCase } from "@application/use-cases/charts";
import { useAuth } from "./useAuth";

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
    refetch: () => void;
    /** Fetch earlier data (for lazy loading) */
    fetchPrevious: () => void;
    /** Fetch later data (for lazy loading) */
    fetchNext: () => void;
    /** Window boundaries */
    windowStart: number;
    windowEnd: number;
}

// Memory cap for chart bars
const MAX_BARS = 5000;

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

    // Create use case with dependencies
    const { user } = useAuth();
    const useCase = useMemo(() => {
        const chartBarRepository = new DexieChartBarRepository();
        const supabaseChartBarRepository = user?.id 
            ? new SupabaseChartBarRepository(user.id)
            : undefined;
        const api = new CTraderAPI();
        return new LoadChartWindowUseCase(api, chartBarRepository, supabaseChartBarRepository);
    }, [user?.id]);

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

            // Apply memory cap
            const cappedBars =
                result.bars.length > MAX_BARS
                    ? result.bars.slice(-MAX_BARS) // Keep most recent bars
                    : result.bars;

            setData(cappedBars);
            setFromCache(result.fromCache);
            setWindowStart(result.windowStart);
            setWindowEnd(result.windowEnd);
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
        if (windowStart === 0 || isLoading) return;

        const newWindowStart = windowStart - windowDays * 24 * 60 * 60 * 1000;

        try {
            const chartBarRepository = new DexieChartBarRepository();
            const previousBars = await chartBarRepository.getByWindow(
                trade.symbol,
                timeframe,
                newWindowStart,
                windowStart,
                broker
            );

            if (previousBars.length > 0) {
                let added = 0;
                setData((prev) => {
                    const earliest = prev[0]?.timestamp ?? null;
                    const filtered = earliest != null
                        ? previousBars.filter((bar) => bar.timestamp < earliest)
                        : previousBars;
                    if (filtered.length === 0) return prev;

                    added = filtered.length;
                    const combined = [...filtered, ...prev];
                    let next = combined;
                    if (combined.length > MAX_BARS) {
                        // Keep earliest bars when paging left
                        next = combined.slice(0, MAX_BARS);
                        const newEnd = next[next.length - 1]?.timestamp;
                        if (newEnd && newEnd !== windowEnd) {
                            setWindowEnd(newEnd);
                        }
                    }
                    return next;
                });
                if (added > 0) {
                    setWindowStart(newWindowStart);
                }
            }
        } catch (err) {
            console.error("Failed to fetch previous data:", err);
        }
    }, [windowStart, windowEnd, isLoading, trade.symbol, timeframe, windowDays, broker]);

    // Lazy loading: fetch next chunk
    const fetchNext = useCallback(async () => {
        if (windowEnd === 0 || isLoading) return;

        const newWindowEnd = windowEnd + windowDays * 24 * 60 * 60 * 1000;

        try {
            const chartBarRepository = new DexieChartBarRepository();
            const nextBars = await chartBarRepository.getByWindow(
                trade.symbol,
                timeframe,
                windowEnd,
                newWindowEnd,
                broker
            );

            if (nextBars.length > 0) {
                setData((prev) => {
                    const combined = [...prev, ...nextBars];
                    let next = combined;
                    if (combined.length > MAX_BARS) {
                        // Keep most recent bars when paging right
                        next = combined.slice(-MAX_BARS);
                        const newStart = next[0]?.timestamp;
                        if (newStart && newStart !== windowStart) {
                            setWindowStart(newStart);
                        }
                    }
                    return next;
                });
                setWindowEnd(newWindowEnd);
            }
        } catch (err) {
            console.error("Failed to fetch next data:", err);
        }
    }, [windowEnd, windowStart, isLoading, trade.symbol, timeframe, windowDays, broker]);

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
