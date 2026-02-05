import type { IChartBarRepository } from "@application/ports/repositories";
import type { ICTraderAPI } from "@application/ports/services";
import type { ChartBar, ChartTimeframe, Trade } from "@domain/entities";

export interface LoadChartWindowParams {
    accessToken?: string;
    trade: Trade;
    timeframe: ChartTimeframe;
    windowDays?: number;
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
        private readonly chartBarRepository: IChartBarRepository
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

        // Try cache first
        const cachedBars = await this.chartBarRepository.getByWindow(
            params.trade.symbol,
            params.timeframe,
            from,
            to
        );

        // If we have reasonable cached data, use it
        if (cachedBars.length > 10) {
            return {
                bars: cachedBars.sort((a, b) => a.timestamp - b.timestamp),
                fromCache: true,
                windowStart: from,
                windowEnd: to,
            };
        }

        // Fallback to API if access token provided
        if (params.accessToken) {
            try {
                const apiBars = await this.api.getBars(
                    params.accessToken,
                    params.trade.symbol,
                    params.timeframe,
                    from,
                    to,
                    params.trade.accountId
                );

                // Store in cache for next time
                if (apiBars.length > 0) {
                    await this.chartBarRepository.upsertMany(apiBars);
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
