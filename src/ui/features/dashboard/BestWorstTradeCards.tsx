"use client";

import type { Trade } from "@domain/entities";
import { format } from "date-fns";
import Link from "next/link";
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

  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground">{trade.symbol}</p>
          <p className="text-xs text-muted-foreground">
            {format(new Date(trade.openTime), "MMM d, yyyy")}
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
          {trade.direction} {volumeToLots(trade.volume ?? 0, trade.symbol ?? "").toFixed(2)} lots
        </span>
      </div>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full text-left rounded-lg border p-3 hover:bg-accent/50 transition-colors"
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      href={trade.id ? `/trades/${trade.id}` : "#"}
      className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
    >
      {content}
    </Link>
  );
}

export function BestWorstTradeCards({
  best,
  worst,
  onBestClick,
  onWorstClick,
}: BestWorstTradeCardsProps) {
  const bestIds = best.map((t) => t.id).filter((id): id is number => id != null);
  const worstIds = worst.map((t) => t.id).filter((id): id is number => id != null);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <button
          type="button"
          onClick={() => onBestClick?.(bestIds)}
          className={`w-full text-left text-sm font-medium text-foreground mb-3 flex items-center gap-2 ${onBestClick ? "cursor-pointer hover:text-emerald-400 transition-colors" : ""}`}
        >
          <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          Best Trades
        </button>
        <div className="space-y-2">
          {best.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            best.map((t) => (
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
          className={`w-full text-left text-sm font-medium text-foreground mb-3 flex items-center gap-2 ${onWorstClick ? "cursor-pointer hover:text-destructive/80 transition-colors" : ""}`}
        >
          <ArrowDownRight className="w-4 h-4 text-destructive" />
          Worst Trades
        </button>
        <div className="space-y-2">
          {worst.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            worst.map((t) => (
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
