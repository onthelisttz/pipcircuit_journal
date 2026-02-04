"use client";

import { motion } from "framer-motion";
import { Trophy, XCircle, TrendingUp, TrendingDown } from "lucide-react";

interface AdditionalStatsCardsProps {
  maxConsecutiveWins: number;
  maxConsecutiveWinsProfit: number;
  maxConsecutiveLosses: number;
  maxConsecutiveLossesProfit: number;
  totalLongTrades: number;
  totalLongProfit: number;
  totalShortTrades: number;
  totalShortProfit: number;
  onCardClick?: (cardKey: string) => void;
}

function formatMoney(value: number): string {
  const sign = value >= 0 ? "+" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function AdditionalStatsCards({
  maxConsecutiveWins,
  maxConsecutiveWinsProfit,
  maxConsecutiveLosses,
  maxConsecutiveLossesProfit,
  totalLongTrades,
  totalLongProfit,
  totalShortTrades,
  totalShortProfit,
  onCardClick,
}: AdditionalStatsCardsProps) {
  const cards = [
    {
      key: "max-consecutive-wins",
      label: "Max Consecutive Wins",
      value: `${maxConsecutiveWins} (${formatMoney(maxConsecutiveWinsProfit)})`,
      icon: Trophy,
      positive: true,
    },
    {
      key: "max-consecutive-losses",
      label: "Max Consecutive Losses",
      value: `${maxConsecutiveLosses} (${formatMoney(maxConsecutiveLossesProfit)})`,
      icon: XCircle,
      positive: false,
    },
    {
      key: "total-long-trades",
      label: "Total Long Trades",
      value: `${totalLongTrades} (${formatMoney(totalLongProfit)})`,
      icon: TrendingUp,
      positive: totalLongProfit >= 0,
    },
    {
      key: "total-short-trades",
      label: "Total Short Trades",
      value: `${totalShortTrades} (${formatMoney(totalShortProfit)})`,
      icon: TrendingDown,
      positive: totalShortProfit >= 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((card, i) => {
        const Icon = card.icon;
        const isClickable = !!onCardClick;
        return (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={`rounded-xl border border-border bg-card p-4 ${!isClickable ? "cursor-default" : ""}`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{card.label}</span>
              <Icon
                className={`w-4 h-4 ${
                  card.positive ? "text-emerald-500" : "text-destructive"
                }`}
              />
            </div>
            {isClickable ? (
              <button
                type="button"
                onClick={() => onCardClick(card.key)}
                className={`mt-1 block w-full text-left text-lg font-semibold focus:outline-none ${
                  card.positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                }`}
              >
                {card.value}
              </button>
            ) : (
              <p
                className={`mt-1 text-lg font-semibold cursor-default ${
                  card.positive ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                }`}
              >
                {card.value}
              </p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
