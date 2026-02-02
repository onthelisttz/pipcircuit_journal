"use client";

import { useTrade } from "@ui/hooks";
import { TradeChartTab } from "./TradeChartTab";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

export interface TradeDetailViewProps {
    tradeId: number;
}

export function TradeDetailView({ tradeId }: TradeDetailViewProps) {
    const router = useRouter();
    const { trade, isLoading, error } = useTrade(tradeId);

    if (isLoading) {
        return (
            <div className="flex h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-96 flex-col items-center justify-center gap-4">
                <p className="text-red-400">Error loading trade: {error.message}</p>
                <button
                    onClick={() => router.back()}
                    className="text-sm text-gray-400 hover:text-gray-200 underline"
                >
                    Go Back
                </button>
            </div>
        );
    }

    if (!trade) {
        return (
            <div className="flex h-96 flex-col items-center justify-center gap-4">
                <p className="text-gray-500">Trade not found</p>
                <button
                    onClick={() => router.back()}
                    className="text-sm text-gray-400 hover:text-gray-200 underline"
                >
                    Go Back
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-800 pb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-100 flex items-center gap-3">
                        <span className={trade.direction === "Buy" ? "text-green-400" : "text-red-400"}>
                            {trade.direction.toUpperCase()}
                        </span>
                        <span>{trade.symbol}</span>
                        <span className="text-gray-500 text-lg font-normal">#{trade.ticketId ?? trade.id}</span>
                    </h1>
                    <p className="mt-1 text-sm text-gray-400">
                        Opened {trade.openTime.toLocaleString()}
                    </p>
                </div>

                {trade.closePrice && (
                    <div className="text-right">
                        <div className={`text-xl font-bold ${(trade.netProfit ?? 0) >= 0 ? "text-green-400" : "text-red-400"
                            }`}>
                            {(trade.netProfit ?? 0) >= 0 ? "+" : ""}{trade.netProfit?.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">Net Profit</div>
                    </div>
                )}
            </div>

            {/* Tabs / Chart Area */}
            <TradeChartTab trade={trade} />
        </div>
    );
}
