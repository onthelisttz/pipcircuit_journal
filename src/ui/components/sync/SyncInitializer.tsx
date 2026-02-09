"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@ui/hooks/useAuth";
import { InitializeSyncUseCase } from "@application/use-cases/sync";
import { AnalyzeTradesForBarSyncUseCase } from "@application/use-cases/sync";
import { PlanBarSyncUseCase } from "@application/use-cases/sync";
import { DexieTradeRepository } from "@infrastructure/db/dexie/repositories";
import { DexieAccountRepository } from "@infrastructure/db/dexie/repositories";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { DualSymbolSyncProgressRepository } from "@infrastructure/db/DualSymbolSyncProgressRepository";
import { SupabaseSymbolSyncProgressRepository } from "@infrastructure/db/supabase/repositories";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { isOnline, onConnectionChange } from "@infrastructure/sync/utils/connection";
import { SupabaseSyncQueue } from "@infrastructure/sync/SupabaseSyncQueue";
import { SupabaseChartBarRepository } from "@infrastructure/db/supabase/repositories";
import { HybridSyncChartBarsUseCase } from "@application/use-cases/sync";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { CTraderAPI } from "@infrastructure/api/ctrader/CTraderAPI";
import { TokenStorage } from "@infrastructure/auth";

/**
 * SyncInitializer - Component that initializes sync after login
 *
 * Automatically analyzes trades and creates sync plans when user logs in.
 * Runs in background and doesn't block UI.
 */
export function SyncInitializer() {
  const { user } = useAuth();
  const [isInitializing, setIsInitializing] = useState(false);
  const initializedRef = useRef(false);
  const progressRepo = useMemo(() => {
    const dexie = new DexieSymbolSyncProgressRepository();
    return user?.id
      ? new DualSymbolSyncProgressRepository(
          dexie,
          new SupabaseSymbolSyncProgressRepository(user.id)
        )
      : dexie;
  }, [user?.id]);
  const { refresh } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  useEffect(() => {
    if (!user?.id || initializedRef.current || !isOnline()) {
      return;
    }

    // Prevent multiple initializations
    if (isInitializing) {
      return;
    }

    const initializeSync = async () => {
      setIsInitializing(true);
      initializedRef.current = true;

      try {
        // Create use cases (progressRepo from component scope - Dual when user.id, updates both Dexie + Supabase)
        const tradeRepo = new DexieTradeRepository();
        const accountRepo = new DexieAccountRepository();

        const analyzeUseCase = new AnalyzeTradesForBarSyncUseCase(tradeRepo, accountRepo);
        const planUseCase = new PlanBarSyncUseCase(progressRepo);

        const initUseCase = new InitializeSyncUseCase(
          tradeRepo,
          accountRepo,
          analyzeUseCase,
          planUseCase
        );

        // Initialize sync (creates plans, doesn't execute them yet)
        console.log(`[SyncInitializer] Calling InitializeSyncUseCase.execute...`);
        const result = await initUseCase.execute({
          userId: user.id,
          forceFull: false,
        });
        console.log(`[SyncInitializer] InitializeSyncUseCase result:`, {
          success: result.success,
          plans: result.plans.length,
          brokers: result.brokers,
          symbols: result.symbols,
          error: result.error,
        });

        if (result.success && result.plans.length > 0) {
          console.log(
            `[SyncInitializer] Created ${result.plans.length} sync plans for ${result.brokers} brokers, ${result.symbols} symbols`
          );

          // Reload progress to show new plans
          console.log(`[SyncInitializer] Refreshing progress...`);
          // Add a small delay to ensure Dexie transaction is committed
          await new Promise(resolve => setTimeout(resolve, 200));
          await refresh();
          console.log(`[SyncInitializer] Progress refreshed`);
          
          // Force a second refresh after a bit more delay to ensure UI updates
          setTimeout(async () => {
            console.log(`[SyncInitializer] Second refresh to ensure UI updates...`);
            await refresh();
            console.log(`[SyncInitializer] Second refresh completed`);
          }, 500);
        } else {
          if (result.error) {
            console.error("[SyncInitializer] Sync initialization failed:", result.error);
          } else {
            console.log(`[SyncInitializer] No sync plans needed (brokers: ${result.brokers}, symbols: ${result.symbols})`);
          }
        }

        // Process any queued Supabase syncs in background
        if (isOnline() && user.id) {
          try {
            const supabaseRepo = new SupabaseChartBarRepository(user.id);
            const queueResult = await SupabaseSyncQueue.processQueue(supabaseRepo);
            if (queueResult.processed > 0 || queueResult.failed > 0) {
              console.log(
                `[SyncInitializer] Processed Supabase sync queue: ${queueResult.processed} succeeded, ${queueResult.failed} failed`
              );
            }
          } catch (error) {
            console.warn("[SyncInitializer] Failed to process Supabase sync queue:", error);
          }
        }
      } catch (error) {
        console.error("[SyncInitializer] Failed to initialize sync:", error);
        initializedRef.current = false; // Allow retry
      } finally {
        setIsInitializing(false);
      }
    };

    // Small delay to ensure everything is loaded
    const timeout = setTimeout(() => {
      void initializeSync();
    }, 1000);

    return () => {
      clearTimeout(timeout);
    };
  }, [user?.id, isInitializing, refresh, progressRepo]);

  // Reset initialization flag when user logs out
  useEffect(() => {
    if (!user?.id) {
      initializedRef.current = false;
    }
  }, [user?.id]);

  // Process Supabase sync queue periodically in background
  useEffect(() => {
    if (!user?.id || !isOnline()) {
      return;
    }

    const processQueue = async () => {
      try {
        const supabaseRepo = new SupabaseChartBarRepository(user.id);
        const result = await SupabaseSyncQueue.processQueue(supabaseRepo);
        if (result.processed > 0) {
          console.log(`[SyncInitializer] Processed ${result.processed} queued Supabase syncs`);
        }
      } catch (error) {
        console.warn("[SyncInitializer] Error processing Supabase sync queue:", error);
      }
    };

    // Process immediately
    void processQueue();

    // Then process every 5 minutes
    const interval = setInterval(() => {
      void processQueue();
    }, 5 * 60 * 1000); // 5 minutes

    return () => {
      clearInterval(interval);
    };
  }, [user?.id]);

  // Auto-resume stuck syncs when network reconnects
  useEffect(() => {
    if (!user?.id) {
      return;
    }

    const resumeStuckSyncs = async () => {
      if (!isOnline()) {
        return;
      }

      try {
        console.log(`[SyncInitializer] Checking for stuck syncs to resume...`);
        const allProgress = await progressRepo.getAll();
        
        // Find syncs that are stuck (syncing status but no recent activity)
        const stuckSyncs = allProgress.filter((p) => {
          if (p.status !== "syncing") return false;
          
          // Consider stuck if lastSyncTime is more than 5 minutes ago
          if (p.lastSyncTime) {
            const timeSinceLastSync = Date.now() - new Date(p.lastSyncTime).getTime();
            return timeSinceLastSync > 5 * 60 * 1000; // 5 minutes
          }
          
          // Or if no lastSyncTime but has progress (might be stuck)
          return p.progressPercent !== undefined && p.progressPercent > 0 && p.progressPercent < 100;
        });

        if (stuckSyncs.length === 0) {
          console.log(`[SyncInitializer] No stuck syncs found`);
          return;
        }

        console.log(`[SyncInitializer] Found ${stuckSyncs.length} stuck syncs, resuming...`);

        const token = TokenStorage.getGlobal();
        if (!token) {
          console.warn(`[SyncInitializer] No access token, cannot resume syncs`);
          return;
        }

        // Resume each stuck sync
        for (const progress of stuckSyncs) {
          try {
            console.log(`[SyncInitializer] Resuming stuck sync for ${progress.broker}:${progress.symbol}`);
            
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
            const fromDate = progress.lastSyncTime 
              ? new Date(progress.lastSyncTime)
              : progress.firstBarDate 
              ? new Date(progress.firstBarDate)
              : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
            
            const toDate = progress.lastBarDate 
              ? new Date(progress.lastBarDate)
              : new Date();

            // Resume sync (don't await - let it run in background)
            syncUseCase.execute({
              userId: user.id,
              broker: progress.broker,
              symbol: progress.symbol,
              fromDate,
              toDate,
              accessToken: token.accessToken,
            }).catch((error) => {
              console.error(`[SyncInitializer] Failed to resume sync for ${progress.symbol}:`, error);
            });

            // Small delay between resumes to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`[SyncInitializer] Error resuming sync for ${progress.symbol}:`, error);
          }
        }
      } catch (error) {
        console.error("[SyncInitializer] Error checking for stuck syncs:", error);
      }
    };

    // Subscribe to connection changes
    const unsubscribe = onConnectionChange((online) => {
      if (online && user?.id) {
        // Network reconnected, check for stuck syncs
        console.log(`[SyncInitializer] Network reconnected, checking for stuck syncs...`);
        void resumeStuckSyncs();
      }
    });

    // Also check on mount if online
    if (isOnline() && user?.id) {
      void resumeStuckSyncs();
    }

    return () => {
      unsubscribe();
    };
  }, [user?.id, progressRepo]);

  return null; // This component doesn't render anything
}
