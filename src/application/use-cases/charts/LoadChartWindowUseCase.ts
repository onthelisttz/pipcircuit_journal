import type { IChartBarRepository } from "@application/ports/repositories";
import type { ICTraderAPI } from "@application/ports/services";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

const MIN_BARS_FOR_CHART = 200;

export interface LoadChartWindowParams {
    accessToken?: string;
    trade: Trade;
    timeframe: ChartTimeframe;
    windowDays?: number;
    /** Broker identifier for broker-based queries (optional) */
    broker?: string;
}

export interface LoadChartWindowResult {
    bars: ChartBar[];
    fromCache: boolean;
    windowStart: number;
    windowEnd: number;
}

/**
 * LoadChartWindowUseCase - Cache-first chart data loading
 *
 * Loads chart bars for a trade, trying Dexie cache first,
 * then falling back to cTrader API if cache is empty.
 */
export class LoadChartWindowUseCase {
    constructor(
        private readonly api: ICTraderAPI,
        private readonly chartBarRepository: IChartBarRepository,
        private readonly supabaseChartBarRepository?: IChartBarRepository
    ) { }

    /**
     * Safely get timestamp from trade date (handles Date, string, or number from Dexie)
     */
    private toTimestamp(d: Date | string | number | null | undefined): number {
        if (d == null) return 0;
        if (typeof d === "number") return d;
        if (typeof d === "string") return new Date(d).getTime();
        return d.getTime();
    }

    /**
     * Calculate adaptive window size based on trade duration
     */
    private calculateWindow(trade: Trade, windowDays: number): { from: number; to: number } {
        const openTime = this.toTimestamp(trade.openTime);
        const closeTime = trade.closeTime ? this.toTimestamp(trade.closeTime) : openTime;
        const tradeDuration = closeTime - openTime;

        // Adaptive window: longer trades get more context
        const DAY_MS = 24 * 60 * 60 * 1000;
        let contextWindow = windowDays * DAY_MS;

        // For trades longer than 1 day, scale context window
        if (tradeDuration > DAY_MS) {
            contextWindow = Math.min(tradeDuration, 7 * DAY_MS);
        }

        return {
            from: openTime - contextWindow,
            to: closeTime + contextWindow,
        };
    }

    async execute(params: LoadChartWindowParams): Promise<LoadChartWindowResult> {
        const windowDays = params.windowDays ?? 2;
        const { from, to } = this.calculateWindow(params.trade, windowDays);
        const minBars = MIN_BARS_FOR_CHART;

        // Step 1: Try Dexie cache first (use broker if provided for correct lookup)
        let cachedBars = await this.chartBarRepository.getByWindow(
            params.trade.symbol,
            params.timeframe,
            from,
            to,
            params.broker
        );

        // Fallback: if broker was provided but few bars found, try without broker (broker mismatch or legacy data)
        if (cachedBars.length < minBars && params.broker) {
            const fallbackBars = await this.chartBarRepository.getByWindow(
                params.trade.symbol,
                params.timeframe,
                from,
                to,
                undefined
            );
            if (fallbackBars.length > cachedBars.length) {
                cachedBars = fallbackBars;
            }
        }

        // Use cache if we have enough bars (trade markers can show even if bars don't cover exact trade time)
        if (cachedBars.length >= minBars) {
            return {
                bars: cachedBars.sort((a, b) => a.timestamp - b.timestamp),
                fromCache: true,
                windowStart: from,
                windowEnd: to,
            };
        }

        // Step 2: Dexie has insufficient data, try Supabase if available and online
        if (this.supabaseChartBarRepository && isOnline() && cachedBars.length < minBars) {
            try {
                let supabaseBars = await this.supabaseChartBarRepository.getByWindow(
                    params.trade.symbol,
                    params.timeframe,
                    from,
                    to,
                    params.broker
                );

                if (supabaseBars.length === 0 && params.broker) {
                    supabaseBars = await this.supabaseChartBarRepository.getByWindow(
                        params.trade.symbol,
                        params.timeframe,
                        from,
                        to,
                        undefined
                    );
                }

                if (supabaseBars.length >= minBars) {
                    // Sync Supabase bars to Dexie for next time
                    await this.chartBarRepository.upsertMany(supabaseBars);
                    
                    return {
                        bars: supabaseBars.sort((a, b) => a.timestamp - b.timestamp),
                        fromCache: true, // From Supabase cache
                        windowStart: from,
                        windowEnd: to,
                    };
                }
                // Use Supabase bars even if incomplete if better than Dexie
                if (supabaseBars.length > cachedBars.length) {
                    await this.chartBarRepository.upsertMany(supabaseBars);
                    cachedBars = supabaseBars;
                }
            } catch (error) {
                console.warn("Failed to load from Supabase, falling back to API:", error);
            }
        }

        // Step 3: Both Dexie and Supabase have insufficient data, fetch from cTrader API
        if (params.accessToken && cachedBars.length < minBars) {
            try {
                const apiBars = await this.api.getBars(
                    params.accessToken,
                    params.trade.symbol,
                    params.timeframe,
                    from,
                    to,
                    params.trade.accountId
                );

                // Store in Dexie first (offline-first)
                if (apiBars.length > 0) {
                    const barsWithBroker = params.broker
                        ? apiBars.map((bar) => ({ ...bar, broker: params.broker }))
                        : apiBars;
                    await this.chartBarRepository.upsertMany(barsWithBroker);

                    // Sync to Supabase if available and online
                    if (this.supabaseChartBarRepository && isOnline()) {
                        try {
                            await this.supabaseChartBarRepository.upsertMany(barsWithBroker);
                        } catch (error) {
                            console.warn("Failed to sync to Supabase:", error);
                        }
                    }
                }

                return {
                    bars: apiBars.sort((a, b) => a.timestamp - b.timestamp),
                    fromCache: false,
                    windowStart: from,
                    windowEnd: to,
                };
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                console.warn("Chart API fallback (using cache):", msg);
                // Return cached bars even if incomplete
                return {
                    bars: cachedBars.sort((a, b) => a.timestamp - b.timestamp),
                    fromCache: true,
                    windowStart: from,
                    windowEnd: to,
                };
            }
        }

        // No access token - return whatever cache has
        return {
            bars: cachedBars.sort((a, b) => a.timestamp - b.timestamp),
            fromCache: true,
            windowStart: from,
            windowEnd: to,
        };
    }
}
