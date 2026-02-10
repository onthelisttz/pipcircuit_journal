"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { createTradeRepository } from "@infrastructure/db/createDualRepositories";
import {
  CalculateEquityCurveUseCase,
  CalculateDrawdownUseCase,
  GetDashboardSummaryUseCase,
  CalculateRiskMetricsUseCase,
  GetReturnsByPeriodUseCase,
  GetPerformanceByAssetUseCase,
  GetPerformanceBySessionUseCase,
  GetBestWorstTradesUseCase,
  GetStreakStatsUseCase,
  GetLongShortStatsUseCase,
  GetReturnsByDayOfWeekUseCase,
} from "@application/use-cases";
import type { DashboardFiltersState } from "@ui/features/dashboard/DashboardFilters";
import { Direction } from "@domain/enums";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, format } from "date-fns";
import { useAuth } from "@ui/hooks/useAuth";

export function useDashboard(
  accountId: string | undefined,
  filters: DashboardFiltersState
) {
  const { user } = useAuth();
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Awaited<ReturnType<GetDashboardSummaryUseCase["execute"]>> | null>(null);
  const [equityCurve, setEquityCurve] = useState<Awaited<ReturnType<CalculateEquityCurveUseCase["execute"]>>>([]);
  const [drawdown, setDrawdown] = useState<Awaited<ReturnType<CalculateDrawdownUseCase["execute"]>>>([]);
  const [riskMetrics, setRiskMetrics] = useState<Awaited<ReturnType<CalculateRiskMetricsUseCase["execute"]>> | null>(null);
  const [returns, setReturns] = useState<Awaited<ReturnType<GetReturnsByPeriodUseCase["execute"]>> | null>(null);
  const [assetPerf, setAssetPerf] = useState<Awaited<ReturnType<GetPerformanceByAssetUseCase["execute"]>>>([]);
  const [sessionPerf, setSessionPerf] = useState<Awaited<ReturnType<GetPerformanceBySessionUseCase["execute"]>>>([]);
  const [bestWorst, setBestWorst] = useState<Awaited<ReturnType<GetBestWorstTradesUseCase["execute"]>> | null>(null);
  const [streakStats, setStreakStats] = useState<Awaited<ReturnType<GetStreakStatsUseCase["execute"]>> | null>(null);
  const [longShortStats, setLongShortStats] = useState<Awaited<ReturnType<GetLongShortStatsUseCase["execute"]>> | null>(null);
  const [dayOfWeekReturns, setDayOfWeekReturns] = useState<Awaited<ReturnType<GetReturnsByDayOfWeekUseCase["execute"]>>>([]);

  const query = useMemo(() => {
    const q: Parameters<typeof tradeRepo.list>[0] = {
      accountId: accountId ?? "",
      from: startOfDay(filters.from),
      to: endOfDay(filters.to),
    };
    if (filters.symbols.length > 0) {
      q.symbols = filters.symbols;
    }
    if (filters.direction !== "Both") {
      q.direction = filters.direction;
    }
    return q;
  }, [accountId, filters]);

  const load = useCallback(async () => {
    if (!accountId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [
        summaryResult,
        equityResult,
        drawdownResult,
        riskResult,
        returnsResult,
        assetResult,
        sessionResult,
        bestWorstResult,
        streakResult,
        longShortResult,
        dayOfWeekResult,
      ] = await Promise.all([
        new GetDashboardSummaryUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateEquityCurveUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateDrawdownUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateRiskMetricsUseCase(tradeRepo).execute({ accountId, query }),
        new GetReturnsByPeriodUseCase(tradeRepo).execute({ accountId, query }),
        new GetPerformanceByAssetUseCase(tradeRepo).execute({ accountId, query }),
        new GetPerformanceBySessionUseCase(tradeRepo).execute({ accountId, query }),
        new GetBestWorstTradesUseCase(tradeRepo).execute({ accountId, query, limit: 5 }),
        new GetStreakStatsUseCase(tradeRepo).execute({ accountId, query }),
        new GetLongShortStatsUseCase(tradeRepo).execute({ accountId, query }),
        new GetReturnsByDayOfWeekUseCase(tradeRepo).execute({ accountId, query }),
      ]);

      setSummary(summaryResult);
      setEquityCurve(equityResult);
      setDrawdown(drawdownResult);
      setRiskMetrics(riskResult);
      setReturns(returnsResult);
      setAssetPerf(assetResult);
      setSessionPerf(sessionResult);
      setBestWorst(bestWorstResult);
      setStreakStats(streakResult);
      setLongShortStats(longShortResult);
      setDayOfWeekReturns(dayOfWeekResult);
    } catch (e) {
      console.error("Dashboard load error:", e);
    } finally {
      setLoading(false);
    }
  }, [accountId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    summary,
    equityCurve,
    drawdown,
    riskMetrics,
    returns,
    assetPerf,
    sessionPerf,
    bestWorst,
    streakStats,
    longShortStats,
    dayOfWeekReturns,
    refetch: load,
  };
}

/** Fetches daily returns for a specific month (for calendar). Refetches when viewMonth or filters change. */
export function useCalendarMonthReturns(
  accountId: string | undefined,
  viewMonth: Date,
  symbols: string[],
  direction: Direction | "Both"
) {
  const { user } = useAuth();
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
  const [daily, setDaily] = useState<Awaited<ReturnType<GetReturnsByPeriodUseCase["execute"]>>["daily"]>([]);
  const [loading, setLoading] = useState(false);

  const monthKey = format(viewMonth, "yyyy-MM");
  const query = useMemo(() => {
    const from = startOfMonth(viewMonth);
    const to = endOfMonth(viewMonth);
    const q: Parameters<typeof tradeRepo.list>[0] = {
      accountId: accountId ?? "",
      from: startOfDay(from),
      to: endOfDay(to),
    };
    if (symbols.length > 0) q.symbols = symbols;
    if (direction !== "Both") q.direction = direction;
    return q;
  }, [accountId, monthKey, symbols, direction, viewMonth]);

  useEffect(() => {
    if (!accountId) {
      setDaily([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    new GetReturnsByPeriodUseCase(tradeRepo)
      .execute({ accountId, query })
      .then((r) => {
        setDaily(r.daily);
      })
      .catch(() => setDaily([]))
      .finally(() => setLoading(false));
  }, [accountId, query, tradeRepo]);

  return { daily, loading };
}

export function useDashboardSymbols(accountId: string | undefined): string[] {
  const { user } = useAuth();
  const tradeRepo = useMemo(() => createTradeRepository(user?.id), [user?.id]);
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    if (!accountId) {
      setSymbols([]);
      return;
    }
    tradeRepo
      .list({ accountId })
      .then((trades) => {
        const s = [...new Set(trades.map((t) => t.symbol).filter(Boolean))]
          .filter((sym) => !/^\d+$/.test(sym))
          .sort();
        setSymbols(s);
      })
      .catch(() => setSymbols([]));
  }, [accountId, tradeRepo]);

  return symbols;
}
