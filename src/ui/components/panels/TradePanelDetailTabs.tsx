"use client";

import { format, formatDistanceStrict } from "date-fns";
import { Loader2 } from "lucide-react";
import { useTrade, useAccount } from "@ui/hooks";
import type { Trade } from "@domain/entities";
import { TokenStorage } from "@infrastructure/auth";
import { TradeChartView } from "@ui/components/charts";
import { TradeJournalEditor } from "./TradeJournalEditor";
import { TradeTagsTab } from "./TradeTagsTab";
import { volumeToLots } from "@lib/pnl-estimate";

type TabId = "details" | "journal" | "tags" | "chart" | "pnl";

interface TradePanelDetailTabsProps {
  tradeId: number;
  activeTab: TabId;
  isPanelExpanded?: boolean;
  onPrevTrade?: () => void;
  onNextTrade?: () => void;
  onGoToTradePosition?: (position: number) => void;
  canPrevTrade?: boolean;
  canNextTrade?: boolean;
  currentTradePosition?: number;
  totalTrades?: number;
  isChartExpanded?: boolean;
  onChartExpandedChange?: (expanded: boolean) => void;
  fallbackTrade?: Trade;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

export function TradePanelDetailTabs({
  tradeId,
  activeTab,
  isPanelExpanded = false,
  onPrevTrade,
  onNextTrade,
  onGoToTradePosition,
  canPrevTrade = false,
  canNextTrade = false,
  currentTradePosition,
  totalTrades,
  isChartExpanded = false,
  onChartExpandedChange,
  fallbackTrade,
}: TradePanelDetailTabsProps) {
  const { trade, isLoading, error } = useTrade(tradeId);
  const { accounts } = useAccount();
  const token = TokenStorage.getGlobal();

  if (activeTab === "chart" || activeTab === "pnl") {
    const chartTrade = trade ?? fallbackTrade;
    if (!chartTrade) {
      return (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    const broker = accounts.find((a) => a.accountNumber === chartTrade.accountId)?.broker;

    if (activeTab === "chart") {
      return (
        <div className="-mx-2 h-full">
          <TradeChartView
            trade={chartTrade}
            viewMode="chart"
            fillAvailableHeight={isPanelExpanded}
            onPrevTrade={onPrevTrade}
            onNextTrade={onNextTrade}
            onGoToTradePosition={onGoToTradePosition}
            canPrevTrade={canPrevTrade}
            canNextTrade={canNextTrade}
            currentTradePosition={currentTradePosition}
            totalTrades={totalTrades}
            expanded={isChartExpanded}
            onExpandedChange={onChartExpandedChange}
            initialTimeframe="M1"
            accessToken={token?.accessToken}
            broker={broker}
            chartHeight={420}
          />
        </div>
      );
    }

    return (
      <div className="-mx-2 h-full">
        <TradeChartView
          trade={chartTrade}
          viewMode="pnl"
          fillAvailableHeight={isPanelExpanded}
          onPrevTrade={onPrevTrade}
          onNextTrade={onNextTrade}
          onGoToTradePosition={onGoToTradePosition}
          canPrevTrade={canPrevTrade}
          canNextTrade={canNextTrade}
          currentTradePosition={currentTradePosition}
          totalTrades={totalTrades}
          expanded={isChartExpanded}
          onExpandedChange={onChartExpandedChange}
          initialTimeframe="M1"
          accessToken={token?.accessToken}
          broker={broker}
          profitTimelineHeight={isPanelExpanded ? 520 : 340}
        />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error.message}
      </p>
    );
  }

  if (isLoading || !trade) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (activeTab === "details") {
    const profit = trade.netProfit ?? trade.grossProfit ?? 0;
    const lots =
      trade.lots != null && Number.isFinite(trade.lots)
        ? trade.lots
        : volumeToLots(trade.volume ?? 0, trade.symbol ?? "");
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
                {trade.percentGain.toFixed(1)}%
              </p>
            </div>
          )}
          {trade.balance != null && (
            <div>
              <span className="text-muted-foreground">Balance</span>
              <p className="font-medium">
                {trade.balance >= 0 ? "$" : "-$"}
                {Math.abs(trade.balance).toFixed(2)}
              </p>
            </div>
          )}
          {trade.pips != null && (
            <div>
              <span className="text-muted-foreground">Pips</span>
              <p
                className={`font-medium ${
                  trade.pips >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                }`}
              >
                {trade.pips.toFixed(1)}
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
    return <TradeTagsTab tradeId={tradeId} />;
  }

  return null;
}
