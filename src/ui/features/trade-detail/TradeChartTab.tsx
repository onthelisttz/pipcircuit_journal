"use client";

import type { Trade } from "@domain/entities";
import { TradeChartView } from "@ui/components/charts";
import { useAccount } from "@ui/hooks/useAccount";

export interface TradeChartTabProps {
    /** Trade to display charts for */
    trade: Trade;
    /** Access token for API calls (optional for offline cached data) */
    accessToken?: string;
}

/**
 * TradeChartTab - Chart tab content for trade detail view
 *
 * Displays a complete trade chart visualization including
 * candlestick chart, profit timeline, and chart controls.
 */
export function TradeChartTab({ trade, accessToken }: TradeChartTabProps) {
    const { accounts } = useAccount();
    const broker = accounts.find((a) => a.accountNumber === trade.accountId)?.broker;

    return (
        <div className="space-y-4">
            {/* Header */}
            <div>
                <h3 className="text-lg font-semibold text-gray-100">Trade Chart</h3>
                <p className="text-sm text-gray-500">
                    Price action and profit timeline for this trade
                </p>
            </div>

            {/* Chart View */}
            <TradeChartView
                trade={trade}
                accessToken={accessToken}
                broker={broker}
                initialTimeframe="M1"
                chartHeight={400}
                profitTimelineHeight={200}
            />
        </div>
    );
}
