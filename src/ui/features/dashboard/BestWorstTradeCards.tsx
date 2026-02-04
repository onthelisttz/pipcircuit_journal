"use client";

import type { Trade } from "@domain/entities";
import { format } from "date-fns";
import Link from "next/link";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { volumeToLots } from "@lib/pnl-estimate";

interface BestWorstTradeCardsProps {
  best: Trade[];
  worst: Trade[];
}

function formatProfit(n: number | undefined): string {
  if (n === undefined) return "-";
  const sign = n >= 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

function TradeCard({
  trade,
  variant,
}: {
  trade: Trade;
  variant: "best" | "worst";
}) {
  const profit = trade.netProfit ?? trade.grossProfit ?? 0;
  const isPositive = profit >= 0;

  return (
    <Link
      href={trade.id ? `/trades/${trade.id}` : "#"}
      className="block rounded-lg border p-3 hover:bg-accent/50 transition-colors"
    >
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
    </Link>
  );
}

export function BestWorstTradeCards({ best, worst }: BestWorstTradeCardsProps) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <ArrowUpRight className="w-4 h-4 text-emerald-500" />
          Best Trades
        </h3>
        <div className="space-y-2">
          {best.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            best.map((t) => (
              <TradeCard key={t.id ?? t.ticketId ?? t.openTime.toISOString()} trade={t} variant="best" />
            ))
          )}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-sm font-medium text-foreground mb-3 flex items-center gap-2">
          <ArrowDownRight className="w-4 h-4 text-destructive" />
          Worst Trades
        </h3>
        <div className="space-y-2">
          {worst.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trades</p>
          ) : (
            worst.map((t) => (
              <TradeCard key={t.id ?? t.ticketId ?? t.openTime.toISOString()} trade={t} variant="worst" />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
