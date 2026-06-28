"use client";

import { useEffect, useMemo, useState } from "react";
import { subDays, startOfDay, endOfDay } from "date-fns";
import { TradeOutcome, Direction, Mindset } from "@domain/enums";
import { useAccount, useTradesByQuery, useTagsList } from "@ui/hooks";
import type { TradeQuery } from "@application/ports/repositories";
import { useTradePanel } from "@ui/providers";
import {
  DashboardFilters,
  SummaryCards,
  AdditionalStatsCards,
  EquityCurveChart,
  DrawdownChart,
  ReturnsCharts,
  BestWorstTradeCards,
  AssetAnalysis,
  SessionAnalysis,
  DayOfWeekChart,
  PerformanceCalendar,
  DashboardTradeTable,
} from "@ui/features/dashboard";
import { ScrollToTop } from "@ui/components/common";
import type { DashboardFiltersState } from "@ui/features/dashboard";
import { useDashboard, useDashboardSymbols, useScrollPersistence } from "@ui/hooks";
import Link from "next/link";
import { clampDateToAllTimeStart } from "@lib/date-range";

function getAdvancedQueryFilters(filters: DashboardFiltersState): Pick<
  TradeQuery,
  "ratingValues" | "mindsets" | "tagIds"
> {
  const tagIds = Array.from(
    new Set([
      ...filters.strategyTagIds,
      ...filters.rulesTagIds,
      ...filters.customTagIds,
    ])
  );

  return {
    ratingValues: filters.ratings.length > 0 ? filters.ratings : undefined,
    mindsets: filters.mindsets.length > 0 ? filters.mindsets : undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
  };
}

const defaultFilters: DashboardFiltersState = {
  symbols: [],
  direction: "Both",
  from: subDays(new Date(), 30),
  to: new Date(),
  ratings: [],
  mindsets: [],
  strategyTagIds: [],
  rulesTagIds: [],
  customTagIds: [],
};
const DASHBOARD_FILTERS_KEY = "dashboardFilters";

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry));
}

function parseMindsets(value: unknown): Mindset[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(Object.values(Mindset));
  return value.filter(
    (entry): entry is Mindset => typeof entry === "string" && allowed.has(entry as Mindset)
  );
}

export default function DashboardPage() {
  const { activeAccount } = useAccount();
  const { openPanel, isOpen: isPanelOpen } = useTradePanel();
  const accountId = activeAccount?.accountNumber;
  const [filters, setFilters] = useState<DashboardFiltersState>(() => {
    if (typeof window === "undefined") return defaultFilters;
    try {
      const raw = window.localStorage.getItem(DASHBOARD_FILTERS_KEY);
      if (!raw) return defaultFilters;
      const parsed = JSON.parse(raw) as {
        symbols?: string[];
        direction?: string;
        from?: string;
        to?: string;
        ratings?: number[];
        mindsets?: string[];
        strategyTagIds?: number[];
        rulesTagIds?: number[];
        customTagIds?: number[];
      };
      const rawFrom = parsed.from ? new Date(parsed.from) : defaultFilters.from;
      const rawTo = parsed.to ? new Date(parsed.to) : defaultFilters.to;
      const safeFrom = Number.isFinite(rawFrom.getTime()) ? rawFrom : defaultFilters.from;
      const safeTo = Number.isFinite(rawTo.getTime()) ? rawTo : defaultFilters.to;
      const clampedFrom = clampDateToAllTimeStart(safeFrom);
      const clampedTo = clampDateToAllTimeStart(safeTo);
      const from =
        clampedFrom.getTime() <= clampedTo.getTime() ? clampedFrom : clampedTo;
      const to =
        clampedFrom.getTime() <= clampedTo.getTime() ? clampedTo : clampedFrom;
      const direction: DashboardFiltersState["direction"] =
        parsed.direction === "Buy" || parsed.direction === "Sell" || parsed.direction === "Both"
          ? (parsed.direction as DashboardFiltersState["direction"])
          : defaultFilters.direction;
      return {
        symbols: parsed.symbols ?? defaultFilters.symbols,
        direction,
        from,
        to,
        ratings: parseNumberArray(parsed.ratings).filter((value) => value >= 1 && value <= 5),
        mindsets: parseMindsets(parsed.mindsets),
        strategyTagIds: parseNumberArray(parsed.strategyTagIds),
        rulesTagIds: parseNumberArray(parsed.rulesTagIds),
        customTagIds: parseNumberArray(parsed.customTagIds),
      };
    } catch {
      return defaultFilters;
    }
  });
  const availableSymbols = useDashboardSymbols(accountId);
  const { tags: availableTags } = useTagsList();

  const advancedQuery = useMemo(
    () => getAdvancedQueryFilters(filters),
    [filters]
  );

  // Persist filters whenever they change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        DASHBOARD_FILTERS_KEY,
        JSON.stringify({
          symbols: filters.symbols,
          direction: filters.direction,
          from: filters.from.toISOString(),
          to: filters.to.toISOString(),
          ratings: filters.ratings,
          mindsets: filters.mindsets,
          strategyTagIds: filters.strategyTagIds,
          rulesTagIds: filters.rulesTagIds,
          customTagIds: filters.customTagIds,
        })
      );
    } catch {
      // ignore localStorage errors
    }
  }, [filters]);

  const panelQuery = useMemo(
    () =>
      accountId
        ? ({
            accountId,
            from: startOfDay(filters.from),
            to: endOfDay(filters.to),
            symbols: filters.symbols.length > 0 ? filters.symbols : undefined,
            direction: filters.direction !== "Both" ? filters.direction : undefined,
            ...advancedQuery,
          } as const)
        : null,
    [
      accountId,
      filters.from,
      filters.to,
      filters.symbols,
      filters.direction,
      advancedQuery,
    ]
  );

  const { trades } = useTradesByQuery(panelQuery);

  const formatPanelTitle = (key: string) =>
    key.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const handleSummaryCardClick = (cardKey: string) => {
    if (!panelQuery) return;

    const queryBase: TradeQuery = {
      accountId: panelQuery.accountId,
      from: panelQuery.from,
      to: panelQuery.to,
      symbols: panelQuery.symbols,
      direction: panelQuery.direction,
      ratingValues: panelQuery.ratingValues,
      mindsets: panelQuery.mindsets,
      tagIds: panelQuery.tagIds,
    };

    let query: TradeQuery = queryBase;

    if (cardKey === "breakeven-trades") {
      query = { ...queryBase, outcome: TradeOutcome.Breakeven };
    } else if (cardKey === "winning-trades") {
      query = { ...queryBase, winsOnly: true };
    } else if (cardKey === "losing-trades") {
      query = { ...queryBase, lossesOnly: true };
    }

    openPanel({ title: formatPanelTitle(cardKey), query });
  };

  const handleAdditionalCardClick = (cardKey: string) => {
    if (cardKey === "max-consecutive-wins" && streakStats?.maxWinStreakTradeIds.length) {
      openPanel({
        title: "Max Consecutive Wins",
        tradeIds: streakStats.maxWinStreakTradeIds,
      });
      return;
    }
    if (cardKey === "max-consecutive-losses" && streakStats?.maxLossStreakTradeIds.length) {
      openPanel({
        title: "Max Consecutive Losses",
        tradeIds: streakStats.maxLossStreakTradeIds,
      });
      return;
    }
    if (panelQuery) {
      if (cardKey === "total-long-trades") {
        openPanel({ title: "Total Long Trades", query: { ...panelQuery, direction: Direction.Buy } });
      } else if (cardKey === "total-short-trades") {
        openPanel({ title: "Total Short Trades", query: { ...panelQuery, direction: Direction.Sell } });
      } else {
        openPanel({ title: formatPanelTitle(cardKey), query: panelQuery });
      }
    }
  };

  const {
    loading,
    summary,
    equityCurve,
    drawdown,
    returns,
    assetPerf,
    sessionPerf,
    bestWorst,
    streakStats,
    longShortStats,
    dayOfWeekReturns,
  } = useDashboard(accountId, filters);

  // Use scroll persistence, waiting for loading to complete
  useScrollPersistence("dashboard", !loading);

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
      <div className="sticky top-0 z-10 mb-3 flex flex-col gap-4 bg-background py-3 sm:flex-row sm:items-center sm:justify-between border-b border-border/40">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <DashboardFilters
          filters={filters}
          onChange={setFilters}
          availableSymbols={availableSymbols}
          availableTags={availableTags}
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
              winningTrades={summary.winningTrades}
              losingTrades={summary.losingTrades}
              winningProfit={summary.winningProfit}
              losingProfit={summary.losingProfit}
              percentFromPeak={summary.percentFromPeak}
              onCardClick={handleSummaryCardClick}
            />
          )}

          {streakStats && longShortStats && (
            <AdditionalStatsCards
              maxConsecutiveWins={streakStats.maxWinStreak}
              maxConsecutiveWinsProfit={streakStats.maxWinStreakProfit}
              maxConsecutiveLosses={streakStats.maxLossStreak}
              maxConsecutiveLossesProfit={streakStats.maxLossStreakProfit}
              totalLongTrades={longShortStats.totalLongTrades}
              totalLongProfit={longShortStats.totalLongProfit}
              totalShortTrades={longShortStats.totalShortTrades}
              totalShortProfit={longShortStats.totalShortProfit}
              onCardClick={handleAdditionalCardClick}
            />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <EquityCurveChart data={equityCurve} />
            <DrawdownChart data={drawdown} />
          </div>

          {returns && (
            <ReturnsCharts annual={returns.annual} monthly={returns.monthly} />
          )}

          <PerformanceCalendar
            accountId={accountId!}
            symbols={filters.symbols}
            direction={filters.direction}
            advancedQuery={advancedQuery}
            initialMonth={filters.from}
            onDayClick={
              panelQuery
                ? (date) =>
                  openPanel({
                    title: `Trades on ${date.toLocaleDateString()}`,
                    query: {
                      ...panelQuery,
                      from: startOfDay(date),
                      to: endOfDay(date),
                    },
                  })
                : undefined
            }
            onWeekClick={
              panelQuery
                ? (weekStart, weekEnd) =>
                  openPanel({
                    title: `Trades ${weekStart.toLocaleDateString()} – ${weekEnd.toLocaleDateString()}`,
                    query: {
                      ...panelQuery,
                      from: startOfDay(weekStart),
                      to: endOfDay(weekEnd),
                    },
                  })
                : undefined
            }
            onMonthClick={
              panelQuery
                ? (monthStart, monthEnd) =>
                  openPanel({
                    title: `Trades in ${monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`,
                    query: {
                      ...panelQuery,
                      from: startOfDay(monthStart),
                      to: endOfDay(monthEnd),
                    },
                  })
                : undefined
            }
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <DayOfWeekChart data={dayOfWeekReturns} />
            <SessionAnalysis data={sessionPerf} />
          </div>

          <AssetAnalysis
            data={assetPerf}
            onCellClick={
              panelQuery
                ? (symbol, type, title) =>
                  openPanel({
                    title,
                    query: {
                      ...panelQuery,
                      symbols: [symbol],
                      ...(type === "wins" && { winsOnly: true }),
                      ...(type === "losses" && { lossesOnly: true }),
                    },
                  })
                : undefined
            }
          />

          {bestWorst && (
            <BestWorstTradeCards
              best={bestWorst.best}
              worst={bestWorst.worst}
              onBestClick={(ids, selectedId) =>
                openPanel({ title: "Best Trades", tradeIds: ids, selectedTradeId: selectedId ?? undefined })
              }
              onWorstClick={(ids, selectedId) =>
                openPanel({ title: "Worst Trades", tradeIds: ids, selectedTradeId: selectedId ?? undefined })
              }
            />
          )}

          <div className="w-full">
            <h2 className="text-lg font-semibold text-foreground mb-3">Trade List</h2>
            <DashboardTradeTable
              trades={trades}
              startingBalance={summary != null && activeAccount?.balance != null ? activeAccount.balance - summary.netProfit : 0}
              onRowClick={
                panelQuery
                  ? (trade, allIds) =>
                    openPanel({
                      title: "Trades",
                      tradeIds: allIds,
                      selectedTradeId: trade.id ?? undefined,
                    })
                  : undefined
              }
              onSummaryClick={
                panelQuery
                  ? (filter, tradeIds) =>
                    openPanel({
                      title: filter === "long" ? "Long Trades" : filter === "short" ? "Short Trades" : "All Trades",
                      tradeIds,
                    })
                  : undefined
              }
            />
          </div>
        </>
      )}

      <ScrollToTop
        threshold={400}
        containerSelector="main"
        className={isPanelOpen ? "right-6 md:right-[calc(var(--trade-panel-desktop-width,28rem)+1.5rem)]" : "right-6"}
      />
    </div>
  );
}
