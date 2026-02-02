"use client";

import { useState } from "react";
import { subDays } from "date-fns";
import { useAccount } from "@ui/hooks";
import {
  DashboardFilters,
  SummaryCards,
  EquityCurveChart,
  DrawdownChart,
  RiskGauges,
  ReturnsCharts,
  BestWorstTradeCards,
  AssetAnalysis,
  SessionAnalysis,
} from "@ui/features/dashboard";
import type { DashboardFiltersState } from "@ui/features/dashboard";
import { useDashboard, useDashboardSymbols } from "@ui/hooks";
import Link from "next/link";

const defaultFilters: DashboardFiltersState = {
  symbols: [],
  direction: "Both",
  from: subDays(new Date(), 30),
  to: new Date(),
};

export default function DashboardPage() {
  const { activeAccount } = useAccount();
  const accountId = activeAccount?.accountNumber;
  const [filters, setFilters] = useState<DashboardFiltersState>(defaultFilters);
  const availableSymbols = useDashboardSymbols(accountId);

  const {
    loading,
    summary,
    equityCurve,
    drawdown,
    riskMetrics,
    returns,
    assetPerf,
    sessionPerf,
    bestWorst,
  } = useDashboard(accountId, filters);

  if (!activeAccount) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Link a cTrader account to view analytics.
        </p>
        <Link
          href="/accounts"
          className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Go to Accounts
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-foreground">Analytics Dashboard</h1>
        <DashboardFilters
          filters={filters}
          onChange={setFilters}
          availableSymbols={availableSymbols}
        />
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-card">
          <div className="animate-pulse text-muted-foreground">Loading analytics…</div>
        </div>
      ) : (
        <>
          {summary && (
            <SummaryCards
              netProfit={summary.netProfit}
              totalTrades={summary.totalTrades}
              winRate={summary.winRate}
              maxDrawdown={summary.maxDrawdown}
              breakevenTrades={summary.breakevenTrades}
              percentFromPeak={summary.percentFromPeak}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <EquityCurveChart data={equityCurve} />
            <DrawdownChart data={drawdown} />
          </div>

          {riskMetrics && (
            <RiskGauges
              profitFactor={riskMetrics.profitFactor}
              sharpeRatio={riskMetrics.sharpeRatio}
              sortinoRatio={riskMetrics.sortinoRatio}
              zScore={riskMetrics.zScore}
            />
          )}

          {returns && (
            <ReturnsCharts annual={returns.annual} monthly={returns.monthly} />
          )}

          {bestWorst && (
            <BestWorstTradeCards best={bestWorst.best} worst={bestWorst.worst} />
          )}

          <AssetAnalysis data={assetPerf} />
          <SessionAnalysis data={sessionPerf} />
        </>
      )}
    </div>
  );
}
