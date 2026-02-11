"use client";

import type { Trade } from "@domain/entities";
import { format } from "date-fns";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { volumeToLots } from "@lib/pnl-estimate";

interface BestWorstTradeCardsProps {
  best: Trade[];
  worst: Trade[];
  /** (tradeIds, selectedTradeId when clicking a specific trade) */
  onBestClick?: (tradeIds: number[], selectedTradeId?: number) => void;
  onWorstClick?: (tradeIds: number[], selectedTradeId?: number) => void;
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function TradeCard({
  trade,
  variant,
  onClick,
}: {
  trade: Trade;
  variant: "best" | "worst";
  onClick?: () => void;
}) {
  const profit = trade.netProfit ?? trade.grossProfit ?? 0;
  const isPositive = profit >= 0;
  const percent = trade.percentGain ?? null;
  const balance = trade.balance ?? null;

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{trade.symbol}</p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(trade.openTime), "MMM d, yyyy HH:mm")}
          </p>
        </div>
        <span
          className={`font-semibold ${
            isPositive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
          }`}
        >
          {formatProfit(profit)}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        {variant === "best" ? (
          <ArrowUpRight className="w-3 h-3" />
        ) : (
          <ArrowDownRight className="w-3 h-3" />
        )}
        <span>
          {trade.direction}{" "}
          {(
            trade.lots != null && Number.isFinite(trade.lots)
              ? trade.lots
              : volumeToLots(trade.volume ?? 0, trade.symbol ?? "")
          ).toFixed(2)}{" "}
          lots
        </span>
        {percent != null && (
          <span
            className={`ml-2 font-medium ${
              percent >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
            }`}
          >
            {percent >= 0 ? "+" : ""}
            {percent.toFixed(1)}%
          </span>
        )}
        {balance != null && (
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
            Bal {balance >= 0 ? "$" : "-$"}
            {Math.abs(balance).toFixed(2)}
          </span>
        )}
      </div>
    </>
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full rounded-xl border border-border bg-card p-3 text-left hover:bg-accent/50 transition-colors"
    >
      {content}
    </button>
  );
}

export function BestWorstTradeCards({
  best,
  worst,
  onBestClick,
  onWorstClick,
}: BestWorstTradeCardsProps) {
  // Ensure best trades are profitable and worst trades are losing.
  const bestTrades = best.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) > 0);
  const worstTrades = worst.filter((t) => (t.netProfit ?? t.grossProfit ?? 0) < 0);
  const bestIds = bestTrades.map((t) => t.id).filter((id): id is number => id != null);
  const worstIds = worstTrades.map((t) => t.id).filter((id): id is number => id != null);

  const bestSummary = bestTrades.reduce(
    (acc, t) => {
      const pnl = t.netProfit ?? t.grossProfit ?? 0;
      const gain = t.percentGain ?? 0;
      return {
        count: acc.count + 1,
        profit: acc.profit + pnl,
        gainPercent: acc.gainPercent + gain,
      };
    },
    { count: 0, profit: 0, gainPercent: 0 }
  );

  const worstSummary = worstTrades.reduce(
    (acc, t) => {
      const pnl = t.netProfit ?? t.grossProfit ?? 0;
      const gain = t.percentGain ?? 0;
      return {
        count: acc.count + 1,
        profit: acc.profit + pnl,
        gainPercent: acc.gainPercent + gain,
      };
    },
    { count: 0, profit: 0, gainPercent: 0 }
  );

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => onBestClick?.(bestIds)}
          className={`w-full text-left text-sm font-medium text-foreground mb-3 flex items-center justify-between gap-2 ${
            onBestClick ? "cursor-pointer hover:text-emerald-400 transition-colors" : ""
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <ArrowUpRight className="w-4 h-4 text-emerald-500" />
            Best Trades
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{bestSummary.count} trades</span>
            <span
              className={
                bestSummary.profit >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }
            >
              {formatProfit(bestSummary.profit)}
            </span>
            <span
              className={
                bestSummary.gainPercent >= 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-destructive"
              }
            >
              {bestSummary.gainPercent >= 0 ? "+" : ""}
              {bestSummary.gainPercent.toFixed(1)}%
            </span>
          </span>
        </button>
        <div className="space-y-2">
          {bestTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            bestTrades.map((t) => (
              <TradeCard
                key={t.id ?? t.ticketId ?? t.openTime.toISOString()}
                trade={t}
                variant="best"
                onClick={t.id && onBestClick ? () => onBestClick(bestIds, t.id!) : undefined}
              />
            ))
          )}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => onWorstClick?.(worstIds)}
          className={`w-full text-left text-sm font-medium text-foreground mb-3 flex items-center justify-between gap-2 ${
            onWorstClick ? "cursor-pointer hover:text-destructive/80 transition-colors" : ""
          }`}
        >
          <span className="inline-flex items-center gap-2">
            <ArrowDownRight className="w-4 h-4 text-destructive" />
            Worst Trades
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-2">
            <span>{worstSummary.count} trades</span>
            <span className="text-destructive">
              {formatProfit(worstSummary.profit)}
            </span>
            <span className="text-destructive">
              {worstSummary.gainPercent.toFixed(1)}%
            </span>
          </span>
        </button>
        <div className="space-y-2">
          {worstTrades.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            worstTrades.map((t) => (
              <TradeCard
                key={t.id ?? t.ticketId ?? t.openTime.toISOString()}
                trade={t}
                variant="worst"
                onClick={t.id && onWorstClick ? () => onWorstClick(worstIds, t.id!) : undefined}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
