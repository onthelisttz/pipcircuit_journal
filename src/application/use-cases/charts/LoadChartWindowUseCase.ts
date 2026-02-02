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
     * Calculate adaptive window size based on trade duration
     */
    private calculateWindow(trade: Trade, windowDays: number): { from: number; to: number } {
        const openTime = trade.openTime.getTime();
        const closeTime = trade.closeTime?.getTime() ?? openTime;
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
                    to
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
                console.error("Failed to fetch chart data from API:", error);
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
