"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { DexieTradeRepository } from "@infrastructure/db/dexie";
import {
  CalculateEquityCurveUseCase,
  CalculateDrawdownUseCase,
  GetDashboardSummaryUseCase,
  CalculateRiskMetricsUseCase,
  GetReturnsByPeriodUseCase,
  GetPerformanceByAssetUseCase,
  GetPerformanceBySessionUseCase,
  GetBestWorstTradesUseCase,
} from "@application/use-cases";
import type { DashboardFiltersState } from "@ui/features/dashboard/DashboardFilters";
import { Direction } from "@domain/enums";

const tradeRepo = new DexieTradeRepository();

export function useDashboard(
  accountId: string | undefined,
  filters: DashboardFiltersState
) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Awaited<ReturnType<GetDashboardSummaryUseCase["execute"]>> | null>(null);
  const [equityCurve, setEquityCurve] = useState<Awaited<ReturnType<CalculateEquityCurveUseCase["execute"]>>>([]);
  const [drawdown, setDrawdown] = useState<Awaited<ReturnType<CalculateDrawdownUseCase["execute"]>>>([]);
  const [riskMetrics, setRiskMetrics] = useState<Awaited<ReturnType<CalculateRiskMetricsUseCase["execute"]>> | null>(null);
  const [returns, setReturns] = useState<Awaited<ReturnType<GetReturnsByPeriodUseCase["execute"]>> | null>(null);
  const [assetPerf, setAssetPerf] = useState<Awaited<ReturnType<GetPerformanceByAssetUseCase["execute"]>>>([]);
  const [sessionPerf, setSessionPerf] = useState<Awaited<ReturnType<GetPerformanceBySessionUseCase["execute"]>>>([]);
  const [bestWorst, setBestWorst] = useState<Awaited<ReturnType<GetBestWorstTradesUseCase["execute"]>> | null>(null);

  const query = useMemo(() => {
    const q: Parameters<typeof tradeRepo.list>[0] = {
      accountId: accountId ?? "",
      from: filters.from,
      to: filters.to,
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
      ] = await Promise.all([
        new GetDashboardSummaryUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateEquityCurveUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateDrawdownUseCase(tradeRepo).execute({ accountId, query }),
        new CalculateRiskMetricsUseCase(tradeRepo).execute({ accountId, query }),
        new GetReturnsByPeriodUseCase(tradeRepo).execute({ accountId, query }),
        new GetPerformanceByAssetUseCase(tradeRepo).execute({ accountId, query }),
        new GetPerformanceBySessionUseCase(tradeRepo).execute({ accountId, query }),
        new GetBestWorstTradesUseCase(tradeRepo).execute({ accountId, query, limit: 5 }),
      ]);

      setSummary(summaryResult);
      setEquityCurve(equityResult);
      setDrawdown(drawdownResult);
      setRiskMetrics(riskResult);
      setReturns(returnsResult);
      setAssetPerf(assetResult);
      setSessionPerf(sessionResult);
      setBestWorst(bestWorstResult);
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
    refetch: load,
  };
}

export function useDashboardSymbols(accountId: string | undefined): string[] {
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    if (!accountId) {
      setSymbols([]);
      return;
    }
    tradeRepo
      .list({ accountId })
      .then((trades) => {
        const s = [...new Set(trades.map((t) => t.symbol).filter(Boolean))].sort();
        setSymbols(s);
      })
      .catch(() => setSymbols([]));
  }, [accountId]);

  return symbols;
}
