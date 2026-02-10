"use client";

import { motion } from "framer-motion";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Percent,
  Minus,
  Target,
} from "lucide-react";

interface SummaryCardsProps {
  netProfit: number;
  totalTrades: number;
  winRate: number;
  maxDrawdown: number;
  breakevenTrades: number;
  winningTrades: number;
  losingTrades: number;
  winningProfit: number;
  losingProfit: number;
  percentFromPeak: number;
  /** Called when a card is clicked - receives card key for context */
  onCardClick?: (cardKey: string) => void;
}

function formatMoney(value: number): string {
  const sign = value >= 0 ? "" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

const cardVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.05 },
  }),
};

export function SummaryCards({
  netProfit,
  totalTrades,
  winRate,
  maxDrawdown,
  breakevenTrades,
  winningTrades,
  losingTrades,
  winningProfit,
  losingProfit,
  percentFromPeak,
  onCardClick,
}: SummaryCardsProps) {
  // Defensive defaults in case new fields are missing from older data
  const safeWinningTrades = winningTrades ?? 0;
  const safeLosingTrades = losingTrades ?? 0;
  const safeWinningProfit = winningProfit ?? 0;
  const safeLosingProfit = losingProfit ?? 0;

  const cards = [
    {
      key: "net-profit",
      label: "Net Profit",
      value: formatMoney(netProfit),
      icon: netProfit >= 0 ? TrendingUp : TrendingDown,
      positive: netProfit >= 0,
      clickable: false,
    },
    {
      key: "total-trades",
      label: "Total Trades",
      value: totalTrades.toLocaleString(),
      icon: BarChart3,
      positive: true,
      clickable: true,
    },
    {
      key: "win-rate",
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      icon: Percent,
      positive: winRate >= 50,
      clickable: false,
    },
    {
      key: "max-drawdown",
      label: "Max Drawdown",
      value: formatMoney(maxDrawdown),
      icon: Minus,
      positive: false,
      clickable: false,
    },
    {
      key: "winning-trades",
      label: "Winning Trades",
      value: safeWinningTrades.toString(),
      icon: Target,
      positive: true,
      clickable: true,
    },
    {
      key: "losing-trades",
      label: "Losing Trades",
      value: safeLosingTrades.toString(),
      icon: Target,
      positive: false,
      clickable: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card, i) => {
        const Icon = card.icon;
        const isClickable = onCardClick && card.clickable;
        return (
          <motion.div
            key={card.key}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
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
                onClick={() => onCardClick!(card.key)}
                className="mt-1 block w-full text-left focus:outline-none"
              >
                {card.key === "winning-trades" || card.key === "losing-trades" ? (
                  <div className="text-sm">
                    <span className="text-muted-foreground">
                      {card.key === "winning-trades" ? safeWinningTrades : safeLosingTrades} trades
                    </span>
                    <span
                      className={`ml-2 font-semibold ${
                        card.key === "winning-trades"
                          ? safeWinningProfit >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                          : "text-destructive"
                      }`}
                    >
                      {formatMoney(
                        card.key === "winning-trades" ? safeWinningProfit : safeLosingProfit
                      )}
                    </span>
                  </div>
                ) : (
                  <p
                    className={`text-lg font-semibold ${
                      card.label === "Net Profit"
                        ? netProfit >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-destructive"
                        : card.label === "Max Drawdown"
                          ? "text-destructive"
                          : "text-foreground"
                    }`}
                  >
                    {card.value}
                  </p>
                )}
              </button>
            ) : (
              <p
                className={`mt-1 text-lg font-semibold cursor-default ${
                  card.label === "Net Profit"
                    ? netProfit >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-destructive"
                    : card.label === "Max Drawdown"
                      ? "text-destructive"
                      : "text-foreground"
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
