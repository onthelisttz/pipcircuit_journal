"use client";

import { format, formatDistanceStrict } from "date-fns";
import { Loader2 } from "lucide-react";
import { useTrade } from "@ui/hooks";
import { TradeChartView } from "@ui/components/charts";
import { TradeJournalEditor } from "./TradeJournalEditor";
import { volumeToLots } from "@lib/pnl-estimate";

type TabId = "details" | "journal" | "tags" | "chart";

interface TradePanelDetailTabsProps {
  tradeId: number;
  activeTab: TabId;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

export function TradePanelDetailTabs({
  tradeId,
  activeTab,
}: TradePanelDetailTabsProps) {
  const { trade, isLoading, error } = useTrade(tradeId);

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !trade) {
    return (
      <p className="text-sm text-destructive">
        {error?.message ?? "Trade not found"}
      </p>
    );
  }

  if (activeTab === "details") {
    const profit = trade.netProfit ?? trade.grossProfit ?? 0;
    const lots = volumeToLots(trade.volume ?? 0, trade.symbol ?? "");
    const openDate = trade.openTime ? new Date(trade.openTime) : null;
    const closeDate = trade.closeTime ? new Date(trade.closeTime) : null;
    const duration =
      openDate && closeDate
        ? (() => {
            const ms = closeDate.getTime() - openDate.getTime();
            if (ms <= 0) return "< 1 second";
            return formatDistanceStrict(openDate, closeDate);
          })()
        : null;
    const hasFees =
      (trade.commission ?? trade.swap ?? trade.fee) !== undefined &&
      (trade.commission !== 0 || trade.swap !== 0 || trade.fee !== 0);
    const hasTpSl =
      trade.takeProfit != null ||
      trade.stopLoss != null ||
      trade.outcome != null;

    return (
      <div className="space-y-4 text-sm">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-muted-foreground">Symbol</span>
            <p className="font-medium">{trade.symbol}</p>
          </div>
          {trade.ticketId && (
            <div>
              <span className="text-muted-foreground">Ticket</span>
              <p className="font-medium font-mono text-xs">{trade.ticketId}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Direction</span>
            <p
              className={`font-medium ${
                trade.direction === "Buy"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {trade.direction}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Order Type</span>
            <p className="font-medium">{trade.orderType ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Open</span>
            <p className="font-medium">
              {format(new Date(trade.openTime), "MMM d, yyyy HH:mm")}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Close</span>
            <p className="font-medium">
              {trade.closeTime
                ? format(new Date(trade.closeTime), "MMM d, yyyy HH:mm")
                : "—"}
            </p>
          </div>
          {duration && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Duration</span>
              <p className="font-medium">{duration}</p>
            </div>
          )}
          <div>
            <span className="text-muted-foreground">Entry</span>
            <p className="font-medium">{trade.openPrice?.toFixed(5) ?? "—"}</p>
          </div>
          <div>
            <span className="text-muted-foreground">Exit</span>
            <p className="font-medium">
              {trade.closePrice?.toFixed(5) ?? "—"}
            </p>
          </div>
          <div>
            <span className="text-muted-foreground">Volume</span>
            <p className="font-medium">{lots.toFixed(2)} lots</p>
          </div>
          <div>
            <span className="text-muted-foreground">Net P/L</span>
            <p
              className={`font-semibold ${
                profit >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }`}
            >
              {formatProfit(profit)}
            </p>
          </div>
          {trade.percentGain != null && (
            <div>
              <span className="text-muted-foreground">% Gain</span>
              <p
                className={`font-medium ${
                  trade.percentGain >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {trade.percentGain >= 0 ? "+" : ""}
                {trade.percentGain.toFixed(2)}%
              </p>
            </div>
          )}
          {trade.outcome && (
            <div>
              <span className="text-muted-foreground">Outcome</span>
              <p className="font-medium">{trade.outcome}</p>
            </div>
          )}
          {trade.rating != null && (
            <div>
              <span className="text-muted-foreground">Rating</span>
              <p className="font-medium">{trade.rating}/5</p>
            </div>
          )}
          {trade.mindset && (
            <div>
              <span className="text-muted-foreground">Mindset</span>
              <p className="font-medium">{trade.mindset}</p>
            </div>
          )}
        </div>
        {hasTpSl && (
          <div className="border-t border-border pt-2">
            <span className="text-muted-foreground">Take Profit / Stop Loss</span>
            <p className="text-xs">
              TP: {trade.takeProfit?.toFixed(5) ?? "—"} | SL:{" "}
              {trade.stopLoss?.toFixed(5) ?? "—"}
            </p>
          </div>
        )}
        {hasFees && (
          <div className="border-t border-border pt-2">
            <span className="text-muted-foreground">Fees</span>
            <p className="text-xs">
              Commission: {formatProfit(trade.commission)} | Swap:{" "}
              {formatProfit(trade.swap)} | Fee: {formatProfit(trade.fee)}
            </p>
          </div>
        )}
      </div>
    );
  }

  if (activeTab === "journal") {
    return (
      <TradeJournalEditor tradeId={tradeId} initialComment={trade.comment} />
    );
  }

  if (activeTab === "tags") {
    return (
      <p className="text-sm text-muted-foreground">
        Tags feature coming soon
      </p>
    );
  }

  if (activeTab === "chart") {
    return (
      <div className="-mx-2">
        <TradeChartView
          trade={trade}
          initialTimeframe="M15"
          chartHeight={280}
          profitTimelineHeight={80}
        />
      </div>
    );
  }

  return null;
}
