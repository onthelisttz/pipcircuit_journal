"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
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

interface DeleteBarsDialogState {
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
  const [deleteDialog, setDeleteDialog] = useState<DeleteBarsDialogState | null>(null);
  const [deleteMode, setDeleteMode] = useState<"all" | "recentRange">("all");
  const [deleteRecentFrom, setDeleteRecentFrom] = useState("");
  const [deleteDialogError, setDeleteDialogError] = useState<string | null>(null);
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
    const progress = symbolProgress.find((item) => item.broker === broker && item.symbol === symbol) ?? null;
    const availableEnd = progress?.lastBarDate ? new Date(progress.lastBarDate) : new Date();
    const availableStart = progress?.firstBarDate
      ? new Date(progress.firstBarDate)
      : new Date(availableEnd.getTime() - DAY_MS);

    setDeleteDialog({
      broker,
      symbol,
      availableStart: progress?.firstBarDate ? new Date(progress.firstBarDate) : null,
      availableEnd: progress?.lastBarDate ? new Date(progress.lastBarDate) : null,
    });
    setDeleteMode("all");
    setDeleteRecentFrom(toDateTimeLocalValue(availableStart));
    setDeleteDialogError(null);
  }, [symbolProgress]);

  const handleCloseDeleteDialog = useCallback(() => {
    if (deleteDialog == null) return;
    const symbolKey = `${deleteDialog.broker}:${deleteDialog.symbol}`;
    if (deletingSymbols.has(symbolKey) || syncingSymbols.has(symbolKey)) return;

    setDeleteDialog(null);
    setDeleteMode("all");
    setDeleteRecentFrom("");
    setDeleteDialogError(null);
  }, [deleteDialog, deletingSymbols, syncingSymbols]);

  const updateLocalProgressSnapshot = useCallback(async (
    broker: string,
    symbol: string,
    status: SymbolSyncProgress["status"] = "pending"
  ) => {
    const dexieChartRepo = new DexieChartBarRepository();
    const [totalBars, dateRange] = await Promise.all([
      dexieChartRepo.countBars(broker, symbol, "M1"),
      dexieChartRepo.getDateRange(broker, symbol, "M1"),
    ]);

    await progressRepo.updateStatus(broker, symbol, status);
    await progressRepo.updateProgress(broker, symbol, {
      totalBars,
      firstBarDate: dateRange.firstBarDate,
      lastBarDate: dateRange.lastBarDate,
      lastSyncTime: status === "completed" ? new Date() : null,
      error: null,
      progressPercent: status === "completed" ? 100 : 0,
      currentFetchFrom: null,
      currentFetchTo: null,
      currentFetchStartedAt: null,
    });

    return {
      totalBars,
      firstBarDate: dateRange.firstBarDate,
      lastBarDate: dateRange.lastBarDate,
    };
  }, [progressRepo]);

  const handleDeleteBarsConfirm = useCallback(async () => {
    const target = deleteDialog;
    if (!target || !user?.id) return;

    const symbolKey = `${target.broker}:${target.symbol}`;
    setDeletingSymbols((prev) => new Set(prev).add(symbolKey));
    setError(null);
    setDeleteDialogError(null);

    try {
      const dexieChartRepo = new DexieChartBarRepository();

      if (deleteMode === "all") {
        await dexieChartRepo.deleteAllForSymbol(
          target.broker,
          target.symbol,
          "M1"
        );

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

        setDeleteDialog(null);
        setDeleteMode("all");
        setDeleteRecentFrom("");
        await refresh();
        return;
      }

      if (!isOnline()) {
        setDeleteDialogError("Cannot trim and refetch bars while offline.");
        return;
      }

      const token = TokenStorage.getGlobal();
      if (!token) {
        setDeleteDialogError("No access token available. Please reconnect your cTrader account.");
        return;
      }

      const deleteFromDate = parseDateTimeLocalValue(deleteRecentFrom);
      if (!deleteFromDate) {
        setDeleteDialogError("Choose the date and time where recent-bar deletion should start.");
        return;
      }

      const currentRange = await dexieChartRepo.getDateRange(target.broker, target.symbol, "M1");
      const currentLastBarDate = currentRange.lastBarDate;
      if (!currentLastBarDate) {
        setDeleteDialogError("No local bars were found for this symbol.");
        return;
      }

      if (deleteFromDate > currentLastBarDate) {
        setDeleteDialogError("The selected date/time must be within the current local range.");
        return;
      }

      if (currentRange.firstBarDate && deleteFromDate < currentRange.firstBarDate) {
        setDeleteDialogError("The selected date/time must not be before the first local bar.");
        return;
      }

      const brokerAccount = accounts.find((acc) => acc.broker === target.broker);
      const accountNumber = brokerAccount?.accountNumber;
      const api = new CTraderAPI();
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        progressRepo
      );

      setSyncingSymbols((prev) => new Set(prev).add(symbolKey));

      await dexieChartRepo.deleteByWindow(
        target.symbol,
        "M1",
        deleteFromDate.getTime(),
        currentLastBarDate.getTime(),
        target.broker
      );

      await updateLocalProgressSnapshot(target.broker, target.symbol, "pending");
      await refresh();

      const monthsDiff =
        (currentLastBarDate.getTime() - deleteFromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000 || 60000));

      const result = await Promise.race([
        syncUseCase.execute({
          userId: user.id,
          broker: target.broker,
          symbol: target.symbol,
          fromDate: deleteFromDate,
          toDate: currentLastBarDate,
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

      ensureSyncSucceeded(result, "Failed to refetch the deleted bar section.");

      setDeleteDialog(null);
      setDeleteMode("all");
      setDeleteRecentFrom("");
      await refresh();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      if (deleteMode === "recentRange") {
        setDeleteDialogError(`Failed to delete/refetch bars: ${errorMsg}`);
      } else {
        setError(`Failed to delete bars: ${errorMsg}`);
        setDeleteDialog(null);
      }
      console.error("Delete bars error:", err);
    } finally {
      setDeletingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
      setSyncingSymbols((prev) => {
        const next = new Set(prev);
        next.delete(symbolKey);
        return next;
      });
    }
  }, [
    accounts,
    deleteDialog,
    deleteMode,
    deleteRecentFrom,
    ensureSyncSucceeded,
    progressRepo,
    refresh,
    updateLocalProgressSnapshot,
    user?.id,
  ]);

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

      {deleteDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-foreground">Delete Chart Bars</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose whether to wipe all local bars for{" "}
              <span className="font-medium text-foreground">{deleteDialog.symbol}</span> or remove
              only the recent tail and download that deleted section again.
            </p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={() => setDeleteMode("all")}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  deleteMode === "all"
                    ? "border-destructive/50 bg-destructive/10"
                    : "border-border hover:bg-accent/40"
                }`}
              >
                <div className="text-sm font-medium text-foreground">Delete all bars</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This keeps today&apos;s behavior: remove the symbol&apos;s local M1 history and reset
                  sync so you can start from scratch.
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDeleteMode("recentRange")}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${
                  deleteMode === "recentRange"
                    ? "border-amber-500/50 bg-amber-500/10"
                    : "border-border hover:bg-accent/40"
                }`}
              >
                <div className="text-sm font-medium text-foreground">
                  Delete recent bars from a chosen date/time, then refetch them
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  This trims local history from the selected date/time to the most recent local bar,
                  updates the stored sync progress, and then downloads only that deleted tail again.
                </div>
              </button>
            </div>

            {deleteMode === "recentRange" && (
              <div className="mt-5 space-y-4 rounded-xl border border-border/70 bg-muted/20 p-4">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">Delete recent bars starting from</span>
                  <input
                    type="datetime-local"
                    value={deleteRecentFrom}
                    onChange={(event) => setDeleteRecentFrom(event.target.value)}
                    max={maxRefetchDateTime}
                    disabled={deletingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`)}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                </label>

                {(deleteDialog.availableStart || deleteDialog.availableEnd) && (
                  <p className="text-xs text-muted-foreground">
                    Current local range:{" "}
                    {deleteDialog.availableStart
                      ? deleteDialog.availableStart.toLocaleString()
                      : "unknown"}{" "}
                    {"->"}{" "}
                    {deleteDialog.availableEnd
                      ? deleteDialog.availableEnd.toLocaleString()
                      : "unknown"}
                  </p>
                )}
              </div>
            )}

            {deleteDialogError && (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {deleteDialogError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={handleCloseDeleteDialog}
                disabled={
                  deletingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`) ||
                  syncingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`)
                }
                className="rounded-lg border border-border px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDeleteBarsConfirm()}
                disabled={
                  deletingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`) ||
                  syncingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`)
                }
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${
                  deleteMode === "all"
                    ? "bg-destructive hover:bg-destructive/90"
                    : "bg-amber-600 hover:bg-amber-600/90"
                }`}
              >
                {deletingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`) ||
                syncingSymbols.has(`${deleteDialog.broker}:${deleteDialog.symbol}`)
                  ? deleteMode === "all"
                    ? "Deleting..."
                    : "Deleting and refetching..."
                  : deleteMode === "all"
                    ? "Delete All"
                    : "Delete and Refetch"}
              </button>
            </div>
          </div>
        </div>
      )}

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
