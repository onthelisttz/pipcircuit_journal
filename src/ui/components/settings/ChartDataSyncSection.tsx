"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { RefreshCw, Play, X } from "lucide-react";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { ConfirmDialog } from "@ui/components/common";
import { useAccount } from "@ui/hooks/useAccount";
import { useAuth } from "@ui/hooks/useAuth";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { DualSymbolSyncProgressRepository } from "@infrastructure/db/DualSymbolSyncProgressRepository";
import { SupabaseChartBarRepository } from "@infrastructure/db/supabase/repositories";
import { SupabaseSymbolSyncProgressRepository } from "@infrastructure/db/supabase/repositories";
import { HybridSyncChartBarsUseCase } from "@application/use-cases/sync";
import { CTraderAPI } from "@infrastructure/api/ctrader/CTraderAPI";
import { TokenStorage } from "@infrastructure/auth";
import { SyncStatusCard } from "./SyncStatusCard";
import { BrokerSyncSection } from "./BrokerSyncSection";
import type { SymbolSyncProgress } from "@domain/entities";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { SupabaseSyncQueue } from "@infrastructure/sync/SupabaseSyncQueue";

export function ChartDataSyncSection() {
  const [isLoading, setIsLoading] = useState(false);
  const [syncingBrokers, setSyncingBrokers] = useState<Set<string>>(new Set());
  const [syncingSymbols, setSyncingSymbols] = useState<Set<string>>(new Set());
  const [deletingSymbols, setDeletingSymbols] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ broker: string; symbol: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRequestedRef = useRef(false);

  const { user } = useAuth();
  const progressRepo = useMemo(() => {
    const dexie = new DexieSymbolSyncProgressRepository();
    return user?.id
      ? new DualSymbolSyncProgressRepository(
          dexie,
          new SupabaseSymbolSyncProgressRepository(user.id)
        )
      : dexie;
  }, [user?.id]);
  
  const {
    symbolProgress,
    overallProgress,
    getBrokerProgress,
    refresh,
  } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  const { accounts } = useAccount();

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

    const token = TokenStorage.getGlobal();
    if (!token) {
      setError("No access token available. Please reconnect your cTrader account.");
      return;
    }

    setSyncingBrokers((prev) => new Set(prev).add(broker));
    setError(null);

    try {
      // Get all symbols for this broker
      const brokerSymbols = getBrokerProgress(broker);
      
      // Get first account for this broker (for accountNumber)
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;

      // Create repositories and use case
      console.log(`[ChartDataSync] Creating repositories and use case for ${broker}`);
      const dexieChartRepo = new DexieChartBarRepository();
      const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
      const api = new CTraderAPI();
      
      console.log(`[ChartDataSync] Creating HybridSyncChartBarsUseCase`);
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        supabaseChartRepo,
        progressRepo
      );
      console.log(`[ChartDataSync] Use case created successfully`);

      // Sync each symbol (including completed - incremental sync from lastBarDate to now)
      for (const symbolProgress of brokerSymbols) {
        if (cancelRequestedRef.current) {
          console.log(`[ChartDataSync] Sync cancelled by user`);
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
            console.log(`[ChartDataSync] Incremental sync for completed ${symbolProgress.symbol}`);
          } else {
            // Full sync: from first bar date (or 14 days ago) to last bar date (or now)
            fromDate = symbolProgress.firstBarDate
              ? new Date(symbolProgress.firstBarDate)
              : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
            toDate = symbolProgress.lastBarDate
              ? new Date(symbolProgress.lastBarDate)
              : now;
          }

          console.log(`[ChartDataSync] Starting sync for ${broker}:${symbolProgress.symbol}`, {
            fromDate: fromDate.toISOString(),
            toDate: toDate.toISOString(),
            incremental: symbolProgress.status === "completed",
            accountNumber,
            hasAccessToken: !!token.accessToken,
            tokenLength: token.accessToken?.length,
          });

          console.log(`[ChartDataSync] About to call syncUseCase.execute for ${symbolProgress.symbol}`);
          
          try {
          // Calculate timeout based on date range (allow 1 minute per month of data)
          const monthsDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
          const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000)); // 1-15 minutes
          console.log(`[ChartDataSync] Setting timeout to ${timeoutMs}ms for ${monthsDiff.toFixed(1)} months of data`);
          
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
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`Sync timeout after ${Math.round(timeoutMs/1000)} seconds`)), timeoutMs)
            )
          ]) as Awaited<ReturnType<typeof syncUseCase.execute>>;

            console.log(`[ChartDataSync] Sync completed for ${symbolProgress.symbol}:`, result);
            if (!result.success && result.error?.includes("cancelled")) {
              break;
            }
          } catch (syncError) {
            console.error(`[ChartDataSync] Sync error for ${symbolProgress.symbol}:`, syncError);
            console.error(`[ChartDataSync] Error stack:`, syncError instanceof Error ? syncError.stack : 'No stack');
            // Don't re-throw - let it be handled by outer catch
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to sync ${symbolProgress.symbol}:`, errorMsg);
        } finally {
          setSyncingSymbols((prev) => {
            const next = new Set(prev);
            next.delete(symbolKey);
            return next;
          });
        }
      }

      await refresh();

      // Process any Supabase sync retries (bars that failed to sync during the run)
      if (isOnline() && user?.id) {
        try {
          const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
          const queueResult = await SupabaseSyncQueue.processQueue(supabaseChartRepo);
          if (queueResult.processed > 0) {
            console.log(`[ChartDataSync] Processed ${queueResult.processed} queued Supabase syncs`);
            await refresh();
          }
        } catch (queueErr) {
          console.warn("[ChartDataSync] Supabase queue processing failed:", queueErr);
        }
      }

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
  }, [user?.id, accounts, getBrokerProgress, refresh]);

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

    const token = TokenStorage.getGlobal();
    if (!token) {
      setError("No access token available. Please reconnect your cTrader account.");
      return;
    }

    const symbolKey = `${broker}:${symbol}`;
    setSyncingSymbols((prev) => new Set(prev).add(symbolKey));
    setError(null);
    cancelRequestedRef.current = false;

    try {
      // Get progress for this symbol
      const symbolProgress = await progressRepo.getByBrokerAndSymbol(broker, symbol);
      console.log(`[ChartDataSync] Got progress for ${symbol}:`, symbolProgress);
      
      // Get account for this broker
      const brokerAccount = accounts.find((acc) => acc.broker === broker);
      const accountNumber = brokerAccount?.accountNumber;
      console.log(`[ChartDataSync] Found account for ${broker}:`, brokerAccount?.accountNumber);

      // Create repositories and use case
      console.log(`[ChartDataSync] Creating repositories and use case for single symbol ${symbol}`);
      const dexieChartRepo = new DexieChartBarRepository();
      const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
      const api = new CTraderAPI();
      
      console.log(`[ChartDataSync] Creating HybridSyncChartBarsUseCase for ${symbol}`);
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        supabaseChartRepo,
        progressRepo
      );
      console.log(`[ChartDataSync] Use case created successfully for ${symbol}`);

      const now = new Date();
      let fromDate: Date;
      let toDate: Date;

      if (symbolProgress?.status === "completed" && symbolProgress?.lastBarDate) {
        // Incremental sync: from last bar date to now (only new bars)
        fromDate = new Date(symbolProgress.lastBarDate);
        toDate = now;
        console.log(`[ChartDataSync] Incremental sync for completed ${symbol}`);
      } else {
        // Full sync: from first bar date (or 14 days ago) to last bar date (or now)
        fromDate = symbolProgress?.firstBarDate
          ? new Date(symbolProgress.firstBarDate)
          : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000); // 14 days ago
        toDate = symbolProgress?.lastBarDate
          ? new Date(symbolProgress.lastBarDate)
          : now;
      }

      console.log(`[ChartDataSync] Starting sync for ${broker}:${symbol}`, {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        accountNumber,
        hasAccessToken: !!token.accessToken,
      });

      console.log(`[ChartDataSync] About to call syncUseCase.execute for ${symbol}`);
      
      // Calculate timeout based on date range (allow 1 minute per month of data)
      const monthsDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
      const timeoutMs = Math.max(60000, Math.min(900000, monthsDiff * 60000)); // 1-15 minutes
      console.log(`[ChartDataSync] Setting timeout to ${timeoutMs}ms for ${monthsDiff.toFixed(1)} months of data`);
      
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
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Sync timeout after ${Math.round(timeoutMs/1000)} seconds`)), timeoutMs)
        )
      ]) as Awaited<ReturnType<typeof syncUseCase.execute>>;

      console.log(`[ChartDataSync] Sync completed for ${symbol}:`, result);

      await refresh();

      // Process any Supabase sync retries
      if (isOnline() && user?.id) {
        try {
          const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
          const queueResult = await SupabaseSyncQueue.processQueue(supabaseChartRepo);
          if (queueResult.processed > 0) {
            await refresh();
          }
        } catch (queueErr) {
          console.warn("[ChartDataSync] Supabase queue processing failed:", queueErr);
        }
      }
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
  }, [user?.id, accounts, progressRepo, refresh]);

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
      const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
      const api = new CTraderAPI();
      
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        supabaseChartRepo,
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

          await syncUseCase.execute({
            userId: user.id,
            broker,
            symbol: symbolProgress.symbol,
            fromDate,
            toDate,
            accessToken: token.accessToken,
            accountNumber,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          console.error(`Failed to retry ${symbolProgress.symbol}:`, errorMsg);
        } finally {
          setSyncingSymbols((prev) => {
            const next = new Set(prev);
            next.delete(symbolKey);
            return next;
          });
        }
      }

      await refresh();

      // Process any Supabase sync retries
      if (isOnline() && user?.id) {
        try {
          const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
          const queueResult = await SupabaseSyncQueue.processQueue(supabaseChartRepo);
          if (queueResult.processed > 0) {
            await refresh();
          }
        } catch (queueErr) {
          console.warn("[ChartDataSync] Supabase queue processing failed:", queueErr);
        }
      }
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
  }, [user?.id, accounts, getBrokerProgress, progressRepo, refresh]);

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
      const supabaseChartRepo = new SupabaseChartBarRepository(user.id);

      // Delete from Dexie (local)
      const deletedLocal = await dexieChartRepo.deleteAllForSymbol(
        target.broker,
        target.symbol,
        "M1"
      );
      console.log(`[ChartDataSync] Deleted ${deletedLocal} bars from Dexie for ${target.symbol}`);

      // Delete from Supabase (cloud) if online
      if (isOnline()) {
        await supabaseChartRepo.deleteAllForSymbol(
          target.broker,
          target.symbol,
          "M1"
        );
        console.log(`[ChartDataSync] Deleted bars from Supabase for ${target.symbol}`);
      }

      // Reset progress to pending so user can sync again
      await progressRepo.updateStatus(target.broker, target.symbol, "pending");
      await progressRepo.updateProgress(target.broker, target.symbol, {
        totalBars: 0,
        firstBarDate: null,
        lastBarDate: null,
        lastSyncTime: null,
        error: null,
        progressPercent: 0,
      });

      // Also update Supabase progress if online (for consistency)
      if (isOnline()) {
        const supabaseProgressRepo = new SupabaseSymbolSyncProgressRepository(user.id);
        await supabaseProgressRepo.updateProgress(target.broker, target.symbol, {
          totalBars: 0,
          firstBarDate: null,
          lastBarDate: null,
          lastSyncTime: null,
          error: null,
          progressPercent: 0,
        });
        await supabaseProgressRepo.updateStatus(target.broker, target.symbol, "pending");
      }

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
      });
      if (isOnline() && user?.id) {
        const supabaseProgressRepo = new SupabaseSymbolSyncProgressRepository(user.id);
        await supabaseProgressRepo.updateStatus(broker, symbol, "pending");
        await supabaseProgressRepo.updateProgress(broker, symbol, {
          error: null,
          progressPercent: 0,
        });
      }
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
  }, [user?.id, progressRepo, refresh]);

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
      const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
      const api = new CTraderAPI();
      
      const syncUseCase = new HybridSyncChartBarsUseCase(
        api,
        dexieChartRepo,
        supabaseChartRepo,
        progressRepo
      );

      // Resume from last sync time or continue from current progress
      const fromDate = symbolProgress.lastSyncTime 
        ? new Date(symbolProgress.lastSyncTime) // Resume from last sync point
        : symbolProgress.firstBarDate 
        ? new Date(symbolProgress.firstBarDate)
        : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      
      const toDate = symbolProgress.lastBarDate 
        ? new Date(symbolProgress.lastBarDate)
        : new Date();

      console.log(`[ChartDataSync] Continuing sync for ${broker}:${symbol}`, {
        fromDate: fromDate.toISOString(),
        toDate: toDate.toISOString(),
        lastSyncTime: symbolProgress.lastSyncTime,
        progressPercent: symbolProgress.progressPercent,
      });

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
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Sync timeout after ${Math.round(timeoutMs/1000)} seconds`)), timeoutMs)
        )
      ]) as Awaited<ReturnType<typeof syncUseCase.execute>>;

      console.log(`[ChartDataSync] Continue sync completed for ${symbol}:`, result);
      await refresh();

      // Process any Supabase sync retries
      if (isOnline() && user?.id) {
        try {
          const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
          const queueResult = await SupabaseSyncQueue.processQueue(supabaseChartRepo);
          if (queueResult.processed > 0) {
            await refresh();
          }
        } catch (queueErr) {
          console.warn("[ChartDataSync] Supabase queue processing failed:", queueErr);
        }
      }
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
  }, [user?.id, accounts, progressRepo, refresh]);

  const handleRefresh = useCallback(async () => {
    setIsLoading(true);
    try {
      await refresh();
    } finally {
      setIsLoading(false);
    }
  }, [refresh]);

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-6">
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
            chart sync later when your connection or Supabase is healthy.
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
