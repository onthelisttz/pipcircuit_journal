"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { ConfirmDialog } from "@ui/components/common";
import { useAccount } from "@ui/hooks/useAccount";
import { useAuth } from "@ui/hooks/useAuth";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { HybridSyncChartBarsUseCase } from "@application/use-cases/sync";
import { CTraderAPI } from "@infrastructure/api/ctrader/CTraderAPI";
import { TokenStorage } from "@infrastructure/auth";
import { SyncStatusCard } from "./SyncStatusCard";
import { BrokerSyncSection } from "./BrokerSyncSection";
import type { SymbolSyncProgress } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";

const DAY_MS = 24 * 60 * 60 * 1000;

interface RefetchRangeDialogState {
  broker: string;
  symbol: string;
  availableStart: Date | null;
  availableEnd: Date | null;
}

function toDateTimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function parseDateTimeLocalValue(value: string): Date | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function ChartDataSyncSection() {
  const [isLoading, setIsLoading] = useState(false);
  const [syncingBrokers, setSyncingBrokers] = useState<Set<string>>(new Set());
  const [syncingSymbols, setSyncingSymbols] = useState<Set<string>>(new Set());
  const [deletingSymbols, setDeletingSymbols] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ broker: string; symbol: string } | null>(null);
  const [refetchRangeDialog, setRefetchRangeDialog] = useState<RefetchRangeDialogState | null>(null);
  const [refetchRangeStart, setRefetchRangeStart] = useState("");
  const [refetchRangeEnd, setRefetchRangeEnd] = useState("");
  const [refetchRangeError, setRefetchRangeError] = useState<string | null>(null);
  const [isRefetchingRange, setIsRefetchingRange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const { user } = useAuth();
  const progressRepo = useMemo(() => new DexieSymbolSyncProgressRepository(), []);
  
  const {
    symbolProgress,
    getBrokerProgress,
    refresh,
  } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  const { accounts } = useAccount();
  const maxRefetchDateTime = toDateTimeLocalValue(new Date());
  const ensureSyncSucceeded = useCallback(
    (
      result: Awaited<ReturnType<HybridSyncChartBarsUseCase["execute"]>>,
      fallbackMessage: string
    ) => {
      if (!result.success) {
        throw new Error(result.error ?? fallbackMessage);
      }
      return result;
    },
    []
  );

  // Group symbols by broker
  const brokersMap = new Map<string, SymbolSyncProgress[]>();
  for (const progress of symbolProgress) {
    if (!brokersMap.has(progress.broker)) {
      brokersMap.set(progress.broker, []);
    }
    brokersMap.get(progress.broker)!.push(progress);
  }

  const brokers = Array.from(brokersMap.entries())
    .map(([broker, symbols]) => ({
      broker,
      symbols: symbols.sort((a, b) => a.symbol.localeCompare(b.symbol)),
    }))
    .sort((a, b) => a.broker.localeCompare(b.broker));

  const handleSyncBroker = useCallback(async (broker: string) => {
    if (!user?.id) {
      setError("Please log in to sync");
      return;
    }

    if (!isOnline()) {
      setError("Cannot sync - offline");
      return;
    }

    setSyncingBrokers((prev) => new Set(prev).add(broker));
    setError(null);

    try {
      // Get all symbols for this broker
      const brokerSymbols = getBrokerProgress(broker);
      const token = TokenStorage.getGlobal();
      if (!token) {
        setError("No access token available. Please reconnect your cTrader account.");
        return;
      }
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;
      const dexieChartRepo = new DexieChartBarRepository();
      const api = new CTraderAPI();
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      // Sync each symbol (including completed - incremental sync from lastBarDate to now)
      for (const symbolProgress of brokerSymbols) {
        if (cancelRequestedRef.current) {
          
          break;
        }

        const symbolKey = `${broker}:${symbolProgress.symbol}`;
        setSyncingSymbols((prev) => new Set(prev).add(symbolKey));
        cancelRequestedRef.current = false;

        try {
          const now = new Date();
          let fromDate: Date;
          let toDate: Date;

          if (symbolProgress.status === "completed" && symbolProgress.lastBarDate) {
            // Incremental sync: from last bar date to now (only new bars)
            fromDate = new Date(symbolProgress.lastBarDate);
            toDate = now;
            
          } else {
            // Full sync: from first bar date (or 14 days ago) to last bar date (or now)
            fromDate = symbolProgress.firstBarDate
              ? new Date(symbolProgress.firstBarDate)
              : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
            toDate = symbolProgress.lastBarDate
              ? new Date(symbolProgress.lastBarDate)
              : now;
          }

          // Calculate timeout based on date range (allow 1 minute per month of data)
          const monthsDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
          const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000)); // 1-15 minutes

          const result = await Promise.race([
            syncUseCase.execute({
              userId: user.id,
              broker,
              symbol: symbolProgress.symbol,
              fromDate,
              toDate,
              accessToken: token.accessToken,
              accountNumber,
              shouldCancel: () => cancelRequestedRef.current,
            }),
            new Promise<Awaited<ReturnType<typeof syncUseCase.execute>>>((_, reject) =>
              setTimeout(
                () => reject(new Error(`Sync timeout after ${Math.round(timeoutMs / 1000)} seconds`)),
                timeoutMs
              )
            ),
          ]);

          ensureSyncSucceeded(result, `Failed to sync ${symbolProgress.symbol}`);

          if (cancelRequestedRef.current) {
            break;
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to sync ${symbolProgress.symbol}:`, errorMsg);
          throw new Error(`Failed to sync ${symbolProgress.symbol}: ${errorMsg}`);
        } finally {
          setSyncingSymbols((prev) => {
            const next = new Set(prev);
            next.delete(symbolKey);
            return next;
          });
        }
      }

      await refresh();

      if (cancelRequestedRef.current) {
        setError(null);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to sync broker: ${errorMsg}`);
      console.error("Broker sync error:", err);
    } finally {
      cancelRequestedRef.current = false;
      setSyncingBrokers((prev) => {
        const next = new Set(prev);
        next.delete(broker);
        return next;
      });
    }
  }, [user?.id, accounts, getBrokerProgress, progressRepo, refresh, ensureSyncSucceeded]);

  const handleOpenRefetchRange = useCallback((progress: SymbolSyncProgress) => {
    const availableEnd = progress.lastBarDate ? new Date(progress.lastBarDate) : new Date();
    const availableStart = progress.firstBarDate
      ? new Date(progress.firstBarDate)
      : new Date(availableEnd.getTime() - DAY_MS);

    setRefetchRangeDialog({
      broker: progress.broker,
      symbol: progress.symbol,
      availableStart: progress.firstBarDate ? new Date(progress.firstBarDate) : null,
      availableEnd: progress.lastBarDate ? new Date(progress.lastBarDate) : null,
    });
    setRefetchRangeStart(toDateTimeLocalValue(availableStart));
    setRefetchRangeEnd(toDateTimeLocalValue(availableEnd));
    setRefetchRangeError(null);
  }, []);

  const handleCloseRefetchRange = useCallback(() => {
    if (isRefetchingRange) return;
    setRefetchRangeDialog(null);
    setRefetchRangeStart("");
    setRefetchRangeEnd("");
    setRefetchRangeError(null);
  }, [isRefetchingRange]);

  const handleConfirmRefetchRange = useCallback(async () => {
    if (!refetchRangeDialog) return;

    if (!user?.id) {
      setRefetchRangeError("Please log in to refetch bars.");
      return;
    }

    if (!isOnline()) {
      setRefetchRangeError("Cannot refetch bars while offline.");
      return;
    }

    const token = TokenStorage.getGlobal();
    if (!token) {
      setRefetchRangeError("No access token available. Please reconnect your cTrader account.");
      return;
    }

    const fromDate = parseDateTimeLocalValue(refetchRangeStart);
    const toDate = parseDateTimeLocalValue(refetchRangeEnd);
    const now = new Date();
    if (!fromDate || !toDate) {
      setRefetchRangeError("Choose both a start and end date with time.");
      return;
    }
    if (fromDate > now || toDate > now) {
      setRefetchRangeError("Future date/time is not allowed.");
      return;
    }
    if (fromDate > toDate) {
      setRefetchRangeError("The start date must be before the end date.");
      return;
    }

    const { broker, symbol } = refetchRangeDialog;
    const symbolKey = `${broker}:${symbol}`;
    setRefetchRangeError(null);
    setError(null);
    setIsRefetchingRange(true);
    setSyncingSymbols((prev) => new Set(prev).add(symbolKey));
    cancelRequestedRef.current = false;

    try {
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;
      const dexieChartRepo = new DexieChartBarRepository();
      const api = new CTraderAPI();
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      const monthsDiff =
        (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000));

      const result = await Promise.race([
        syncUseCase.execute({
          userId: user.id,
          broker,
          symbol,
          fromDate,
          toDate,
          accessToken: token.accessToken,
          accountNumber,
          forceFullSync: true,
          shouldCancel: () => cancelRequestedRef.current,
        }),
        new Promise<Awaited<ReturnType<typeof syncUseCase.execute>>>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Refetch timeout after ${Math.round(timeoutMs / 1000)} seconds`)),
            timeoutMs
          )
        ),
      ]);

      if (!result.success) {
        throw new Error(result.error ?? "Failed to refetch the selected range.");
      }

      await refresh();
      setRefetchRangeDialog(null);
      setRefetchRangeStart("");
      setRefetchRangeEnd("");
      setRefetchRangeError(null);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setRefetchRangeError(`Failed to refetch bars: ${errorMsg}`);
      console.error("Refetch range error:", err);
    } finally {
      setIsRefetchingRange(false);
      setSyncingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
    }
  }, [
    refetchRangeDialog,
    user?.id,
    refetchRangeStart,
    refetchRangeEnd,
    accounts,
    progressRepo,
    refresh,
  ]);

  const handleCancelBrokerSync = useCallback((broker: string) => {
    if (syncingBrokers.has(broker)) {
      cancelRequestedRef.current = true;
      setError("Cancelling sync...");
    }
  }, [syncingBrokers]);

  const handleCancelSymbolSync = useCallback((broker: string, symbol: string) => {
    const symbolKey = `${broker}:${symbol}`;
    if (syncingSymbols.has(symbolKey)) {
      cancelRequestedRef.current = true;
      setError("Cancelling sync...");
    }
  }, [syncingSymbols]);

  const handleSyncSymbol = useCallback(async (broker: string, symbol: string) => {
    if (!user?.id) {
      setError("Please log in to sync");
      return;
    }

    if (!isOnline()) {
      setError("Cannot sync - offline");
      return;
    }

    const symbolKey = `${broker}:${symbol}`;
    setSyncingSymbols((prev) => new Set(prev).add(symbolKey));
    setError(null);
    cancelRequestedRef.current = false;

    try {
      // Get progress for this symbol
      const symbolProgress = await progressRepo.getByBrokerAndSymbol(broker, symbol);

      const token = TokenStorage.getGlobal();
      if (!token) {
        setError("No access token available. Please reconnect your cTrader account.");
        return;
      }

      // Get account for this broker
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;

      // Create repositories and use case
      const dexieChartRepo = new DexieChartBarRepository();
      const api = new CTraderAPI();
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      const now = new Date();
      let fromDate: Date;
      let toDate: Date;

      if (symbolProgress?.status === "completed" && symbolProgress?.lastBarDate) {
        // Incremental sync: from last bar date to now (only new bars)
        fromDate = new Date(symbolProgress.lastBarDate);
        toDate = now;
        
      } else {
        // Full sync: from first bar date (or 14 days ago) to last bar date (or now)
        fromDate = symbolProgress?.firstBarDate
          ? new Date(symbolProgress.firstBarDate)
          : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
        toDate = symbolProgress?.lastBarDate
          ? new Date(symbolProgress.lastBarDate)
          : now;
      }

      

      
      
      // Calculate timeout based on date range (allow 1 minute per month of data)
      const monthsDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000)); // 1-15 minutes
      
      
      const result = await Promise.race([
        syncUseCase.execute({
          userId: user.id,
          broker,
          symbol,
          fromDate,
          toDate,
          accessToken: token.accessToken,
          accountNumber,
          shouldCancel: () => cancelRequestedRef.current,
        }),
        new Promise<Awaited<ReturnType<typeof syncUseCase.execute>>>((_, reject) => 
          setTimeout(() => reject(new Error(`Sync timeout after ${Math.round(timeoutMs/1000)} seconds`)), timeoutMs)
        )
      ]);

      ensureSyncSucceeded(result, `Failed to sync ${symbol}`);

      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to sync symbol: ${errorMsg}`);
      console.error("Symbol sync error:", err);
    } finally {
      cancelRequestedRef.current = false;
      setSyncingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
    }
  }, [user?.id, accounts, progressRepo, refresh, ensureSyncSucceeded]);

  const handleRetryFailed = useCallback(async (broker: string) => {
    if (!user?.id) {
      setError("Please log in to sync");
      return;
    }

    if (!isOnline()) {
      setError("Cannot sync - offline");
      return;
    }

    const token = TokenStorage.getGlobal();
    if (!token) {
      setError("No access token available. Please reconnect your cTrader account.");
      return;
    }

    setSyncingBrokers((prev) => new Set(prev).add(broker));
    setError(null);

    try {
      // Get failed symbols for this broker
      const brokerSymbols = getBrokerProgress(broker).filter(
        (p) => p.status === "failed"
      );

      if (brokerSymbols.length === 0) {
        return; // No failed symbols
      }

      // Get account for this broker
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;

      // Create repositories and use case
      const dexieChartRepo = new DexieChartBarRepository();
      const api = new CTraderAPI();
      
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      // Retry each failed symbol
      for (const symbolProgress of brokerSymbols) {
        const symbolKey = `${broker}:${symbolProgress.symbol}`;
        setSyncingSymbols((prev) => new Set(prev).add(symbolKey));

        try {
          // Reset status to pending before retry
          await progressRepo.updateStatus(broker, symbolProgress.symbol, "pending");

          const fromDate = symbolProgress.firstBarDate 
            ? new Date(symbolProgress.firstBarDate)
            : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
          const toDate = symbolProgress.lastBarDate 
            ? new Date(symbolProgress.lastBarDate)
            : new Date();

          const result = await syncUseCase.execute({
            userId: user.id,
            broker,
            symbol: symbolProgress.symbol,
            fromDate,
            toDate,
            accessToken: token.accessToken,
            accountNumber,
          });
          ensureSyncSucceeded(result, `Failed to retry ${symbolProgress.symbol}`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to retry ${symbolProgress.symbol}:`, errorMsg);
          throw new Error(`Failed to retry ${symbolProgress.symbol}: ${errorMsg}`);
        } finally {
          setSyncingSymbols((prev) => {
            const next = new Set(prev);
            next.delete(symbolKey);
            return next;
          });
        }
      }

      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to retry sync: ${errorMsg}`);
      console.error("Retry sync error:", err);
    } finally {
      setSyncingBrokers((prev) => {
        const next = new Set(prev);
        next.delete(broker);
        return next;
      });
    }
  }, [user?.id, accounts, getBrokerProgress, progressRepo, refresh, ensureSyncSucceeded]);

  const handleDeleteBarsClick = useCallback((broker: string, symbol: string) => {
    setDeleteConfirm({ broker, symbol });
  }, []);

  const handleDeleteBarsConfirm = useCallback(async () => {
    const target = deleteConfirm;
    if (!target || !user?.id) return;

    const symbolKey = `${target.broker}:${target.symbol}`;
    setDeletingSymbols((prev) => new Set(prev).add(symbolKey));
    setError(null);

    try {
      const dexieChartRepo = new DexieChartBarRepository();

      // Delete from Dexie (local)
      await dexieChartRepo.deleteAllForSymbol(
        target.broker,
        target.symbol,
        "M1"
      );

      // Reset progress to pending so user can sync again
      await progressRepo.updateStatus(target.broker, target.symbol, "pending");
      await progressRepo.updateProgress(target.broker, target.symbol, {
        totalBars: 0,
        firstBarDate: null,
        lastBarDate: null,
        lastSyncTime: null,
        error: null,
        progressPercent: 0,
        currentFetchFrom: null,
        currentFetchTo: null,
        currentFetchStartedAt: null,
      });

      setDeleteConfirm(null);
      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to delete bars: ${errorMsg}`);
      console.error("Delete bars error:", err);
      setDeleteConfirm(null);
    } finally {
      setDeletingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
    }
  }, [deleteConfirm, user?.id, progressRepo, refresh]);

  const handleResetToPending = useCallback(async (broker: string, symbol: string) => {
    const symbolKey = `${broker}:${symbol}`;
    try {
      await progressRepo.updateStatus(broker, symbol, "pending");
      await progressRepo.updateProgress(broker, symbol, {
        error: null,
        progressPercent: 0,
        currentFetchFrom: null,
        currentFetchTo: null,
        currentFetchStartedAt: null,
      });
      setSyncingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
      setError(null);
      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to reset: ${errorMsg}`);
    }
  }, [progressRepo, refresh]);

  const handleContinueSymbol = useCallback(async (broker: string, symbol: string) => {
    if (!user?.id) {
      setError("Please log in to sync");
      return;
    }

    if (!isOnline()) {
      setError("Cannot sync - offline");
      return;
    }

    const token = TokenStorage.getGlobal();
    if (!token) {
      setError("No access token available. Please reconnect your cTrader account.");
      return;
    }

    const symbolKey = `${broker}:${symbol}`;
    setSyncingSymbols((prev) => new Set(prev).add(symbolKey));
    setError(null);

    try {
      // Get progress for this symbol
      const symbolProgress = await progressRepo.getByBrokerAndSymbol(broker, symbol);
      if (!symbolProgress) {
        setError(`No progress record found for ${symbol}`);
        return;
      }

      // Get account for this broker
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;

      // Create repositories and use case
      const dexieChartRepo = new DexieChartBarRepository();
      const api = new CTraderAPI();
      
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      // Restart from the planned range; the sync use case will resume from the
      // actual last local bar when partial history already exists.
      const fromDate = symbolProgress.firstBarDate 
        ? new Date(symbolProgress.firstBarDate)
        : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      
      const toDate = symbolProgress.lastBarDate 
        ? new Date(symbolProgress.lastBarDate)
        : new Date();

      

      // Calculate timeout based on date range
      const monthsDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000)); // 1-15 minutes
      
      const result = await Promise.race([
        syncUseCase.execute({
          userId: user.id,
          broker,
          symbol,
          fromDate,
          toDate,
          accessToken: token.accessToken,
          accountNumber,
        }),
        new Promise<Awaited<ReturnType<typeof syncUseCase.execute>>>((_, reject) => 
          setTimeout(() => reject(new Error(`Sync timeout after ${Math.round(timeoutMs/1000)} seconds`)), timeoutMs)
        )
      ]);

      ensureSyncSucceeded(result, `Failed to continue sync for ${symbol}`);
      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to continue sync: ${errorMsg}`);
      console.error("Continue sync error:", err);
    } finally {
      setSyncingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
    }
  }, [user?.id, accounts, progressRepo, refresh, ensureSyncSucceeded]);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await refresh();
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Chart Data Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage synchronization of M1 chart bars for offline access
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <SyncStatusCard />

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-destructive">
          <p className="text-sm">{error}</p>
          <p className="mt-1 text-xs text-destructive/80">
            Your existing local bars remain available. You can continue using the app and retry
            chart sync later when your connection is healthy.
          </p>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm != null}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={() => void handleDeleteBarsConfirm()}
        title="Delete chart bars"
        message={
          deleteConfirm
            ? `Delete all synced bars for ${deleteConfirm.symbol}? This will reset the symbol so you can sync from scratch.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        isLoading={
          deleteConfirm != null &&
          deletingSymbols.has(`${deleteConfirm.broker}:${deleteConfirm.symbol}`)
        }
      />

      {refetchRangeDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">
              Refetch Bars
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Fetch M1 bars again for <span className="font-medium text-foreground">{refetchRangeDialog.symbol}</span> between the selected start and end date/time and merge them into local history.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">Start date and time</span>
                <input
                  type="datetime-local"
                  value={refetchRangeStart}
                  onChange={(event) => setRefetchRangeStart(event.target.value)}
                  max={maxRefetchDateTime}
                  disabled={isRefetchingRange}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">End date and time</span>
                <input
                  type="datetime-local"
                  value={refetchRangeEnd}
                  onChange={(event) => setRefetchRangeEnd(event.target.value)}
                  max={maxRefetchDateTime}
                  disabled={isRefetchingRange}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                />
              </label>
            </div>
            {(refetchRangeDialog.availableStart || refetchRangeDialog.availableEnd) && (
              <p className="mt-3 text-xs text-muted-foreground">
                Current local range:{" "}
                {refetchRangeDialog.availableStart
                  ? refetchRangeDialog.availableStart.toLocaleString()
                  : "unknown"}{" "}
                {"->"}{" "}
                {refetchRangeDialog.availableEnd
                  ? refetchRangeDialog.availableEnd.toLocaleString()
                  : "unknown"}
              </p>
            )}
            {refetchRangeError && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {refetchRangeError}
              </div>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={handleCloseRefetchRange}
                disabled={isRefetchingRange}
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleConfirmRefetchRange()}
                disabled={isRefetchingRange}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isRefetchingRange ? "Refetching..." : "Refetch Range"}
              </button>
            </div>
          </div>
        </div>
      )}

      {brokers.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 p-8 text-center">
          <p className="text-muted-foreground">
            No sync progress found. Sync will start automatically after importing trades.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {brokers.map(({ broker, symbols }) => (
            <BrokerSyncSection
              key={broker}
              broker={broker}
              symbols={symbols}
              onSyncBroker={handleSyncBroker}
              onSyncSymbol={handleSyncSymbol}
              onContinueSymbol={handleContinueSymbol}
              onResetToPending={handleResetToPending}
              onRetryFailed={handleRetryFailed}
              onDeleteBars={handleDeleteBarsClick}
              onRefetchRange={handleOpenRefetchRange}
              onCancelBrokerSync={handleCancelBrokerSync}
              onCancelSymbolSync={handleCancelSymbolSync}
              isSyncing={syncingBrokers.has(broker)}
              syncingSymbols={syncingSymbols}
              deletingSymbols={deletingSymbols}
            />
          ))}
        </div>
      )}
    </section>
  );
}
