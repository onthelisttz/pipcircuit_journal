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
  percentFromPeak: number;
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
  percentFromPeak,
}: SummaryCardsProps) {
  const cards = [
    {
      label: "Net Profit",
      value: formatMoney(netProfit),
      icon: netProfit >= 0 ? TrendingUp : TrendingDown,
      positive: netProfit >= 0,
    },
    {
      label: "Total Trades",
      value: totalTrades.toLocaleString(),
      icon: BarChart3,
      positive: true,
    },
    {
      label: "Win Rate",
      value: `${winRate.toFixed(1)}%`,
      icon: Percent,
      positive: winRate >= 50,
    },
    {
      label: "Max Drawdown",
      value: formatMoney(maxDrawdown),
      icon: Minus,
      positive: false,
    },
    {
      label: "Breakeven Trades",
      value: breakevenTrades.toString(),
      icon: Target,
      positive: true,
    },
    {
      label: "% from Peak",
      value: `${percentFromPeak.toFixed(1)}%`,
      icon: Percent,
      positive: percentFromPeak >= 90,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {cards.map((card, i) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.label}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            animate="visible"
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{card.label}</span>
              <Icon
                className={`w-4 h-4 ${
                  card.positive ? "text-emerald-500" : "text-destructive"
                }`}
              />
            </div>
            <p
              className={`mt-1 text-lg font-semibold ${
                card.label === "Net Profit"
                  ? netProfit >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-destructive"
                  : "text-foreground"
              }`}
            >
              {card.value}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}
