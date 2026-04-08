"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@ui/hooks/useAuth";
import { InitializeSyncUseCase } from "@application/use-cases/sync";
import { AnalyzeTradesForBarSyncUseCase } from "@application/use-cases/sync";
import { PlanBarSyncUseCase } from "@application/use-cases/sync";
import { DexieTradeRepository } from "@infrastructure/db/dexie/repositories";
import { DexieAccountRepository } from "@infrastructure/db/dexie/repositories";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { isOnline, onConnectionChange } from "@infrastructure/sync/utils/connection";
import { EntitySyncQueue } from "@infrastructure/sync/EntitySyncQueue";
import { JournalDeltaSyncService } from "@infrastructure/sync/JournalDeltaSyncService";
import { useFullSyncProgressStore } from "@ui/state/fullSyncProgressStore";
import { HybridSyncChartBarsUseCase } from "@application/use-cases/sync";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { CTraderAPI } from "@infrastructure/api/ctrader/CTraderAPI";
import { TokenStorage } from "@infrastructure/auth";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import { FullSyncService } from "@infrastructure/sync/FullSyncService";
import { db } from "@infrastructure/db/dexie/database";
import { reconcileSeededJournalDuplicates } from "@infrastructure/sync/reconcileSeededJournalDuplicates";

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
  const reconnectFlowRunningRef = useRef(false);
  const lastReportedStepRef = useRef<string | null>(null);
  const startSync = useFullSyncProgressStore((state) => state.startSync);
  const updateStep = useFullSyncProgressStore((state) => state.updateStep);
  const finishSync = useFullSyncProgressStore((state) => state.finishSync);
  const reportStep = useCallback(
    (step: string) => {
      if (lastReportedStepRef.current === step) {
        return;
      }
      lastReportedStepRef.current = step;
      updateStep(step);
    },
    [updateStep]
  );
  const progressRepo = useMemo(() => {
    return new DexieSymbolSyncProgressRepository();
  }, []);
  const { refresh } = useSyncProgress({
    repository: progressRepo,
    autoLoad: true,
    subscribe: true,
  });

  useEffect(() => {
    if (!user?.id || initializedRef.current || !isOnline()) {
      return;
    }

    if (isInitializing) {
      return;
    }

    const initializeSync = async () => {
      setIsInitializing(true);
      initializedRef.current = true;

      try {
        const maybeBootstrapFromCloud = async () => {
          if (!isOnline() || !user.id) return;

          const [
            accountsCount,
            tradesCount,
            tradeNotesCount,
            tradeTagsCount,
            observationsCount,
            queuedJobsCount,
          ] = await Promise.all([
            db.accounts.count(),
            db.trades.count(),
            db.trade_notes.count(),
            db.trade_tags.count(),
            db.observations.count(),
            db.sync_queue.count(),
          ]);

          const localCoreIsEmpty =
            accountsCount === 0 &&
            tradesCount === 0 &&
            tradeNotesCount === 0 &&
            tradeTagsCount === 0 &&
            observationsCount === 0 &&
            queuedJobsCount === 0;
          const hasLocalJournalData =
            tradeNotesCount > 0 ||
            tradeTagsCount > 0 ||
            observationsCount > 0;
          const missingCoreData = accountsCount === 0 || tradesCount === 0;
          const shouldBootstrapFromCloud =
            localCoreIsEmpty ||
            (!hasLocalJournalData && missingCoreData);

          if (!shouldBootstrapFromCloud) return;

          startSync("Bootstrapping local data from cloud...");
          try {
            const fullSync = new FullSyncService(user.id);
            const pullResult = await fullSync.pullFromSupabase((step) => reportStep(step));
            if (!pullResult.success) {
              console.warn("[SyncInitializer] Initial cloud bootstrap pull failed:", pullResult);
            }
          } catch (error) {
            console.warn("[SyncInitializer] Initial cloud bootstrap pull failed:", error);
          } finally {
            finishSync();
          }
        };

        await maybeBootstrapFromCloud();

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

        const result = await initUseCase.execute({
          userId: user.id,
          forceFull: false,
        });

        if (result.success && result.plans.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await refresh();

          setTimeout(async () => {
            await refresh();
          }, 500);
        } else if (result.error) {
          console.error("[SyncInitializer] Sync initialization failed:", result.error);
        }

        if (isOnline() && user.id) {
          try {
            startSync("Pulling latest cloud changes...");
            const reconnectSync = new JournalDeltaSyncService(user.id);
            const reconnectResult = await reconnectSync.runReconnectFlow((step) =>
              reportStep(step)
            );
            if (!reconnectResult.success) {
              console.warn(
                "[SyncInitializer] Journal reconnect flow finished with issues:",
                reconnectResult
              );
            }
            await reconcileSeededJournalDuplicates();

            await refresh();
          } catch (error) {
            console.warn("[SyncInitializer] Journal reconnect flow failed:", error);
          } finally {
            finishSync();
          }
        }
      } catch (error) {
        console.error("[SyncInitializer] Failed to initialize sync:", error);
        initializedRef.current = false;
      } finally {
        setIsInitializing(false);
      }
    };

    const timeout = setTimeout(() => {
      void initializeSync();
    }, 1000);

    return () => {
      clearTimeout(timeout);
    };
  }, [user?.id, isInitializing, refresh, progressRepo, startSync, reportStep, finishSync]);

  useEffect(() => {
    if (!user?.id) {
      initializedRef.current = false;
    }
  }, [user?.id]);

  // Process sync queues periodically in background
  useEffect(() => {
    if (!user?.id || !isOnline()) {
      return;
    }

    const processQueue = async () => {
      try {
        await EntitySyncQueue.processQueue(user.id);
      } catch (error) {
        console.warn("[SyncInitializer] Error processing sync queue:", error);
      }
    };

    void processQueue();

    const interval = setInterval(() => {
      void processQueue();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
    };
  }, [user?.id]);

  // Periodic auto-sync: flush queued local changes while online, honoring user settings
  useEffect(() => {
    if (!user?.id || !isOnline()) {
      return;
    }

    let lastPushAt: number | null = null;
    let cancelled = false;

    const tick = async () => {
      if (!user?.id || !isOnline() || cancelled) return;

      try {
        const settingsRepo = createSettingsRepository(user.id);
        const [enabledRec, intervalRec] = await Promise.all([
          settingsRepo.get("sync.autoPushEnabled"),
          settingsRepo.get("sync.autoPushIntervalMinutes"),
        ]);

        const enabled = enabledRec?.value === true;
        if (!enabled) return;

        const minutesRaw = typeof intervalRec?.value === "number" ? intervalRec.value : 10;
        const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 10;
        const intervalMs = minutes * 60 * 1000;

        const now = Date.now();
        if (lastPushAt != null && now - lastPushAt < intervalMs) {
          return;
        }

        const result = await EntitySyncQueue.processQueue(user.id);
        lastPushAt = Date.now();

        if (result.failed > 0) {
          console.warn("[SyncInitializer] Periodic auto-push failed:", result);
        }
      } catch (error) {
        console.warn("[SyncInitializer] Periodic auto-push error:", error);
      }
    };

    const interval = setInterval(() => {
      void tick();
    }, 60 * 1000);

    void tick();

    return () => {
      cancelled = true;
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
        const allProgress = await progressRepo.getAll();

        const stuckSyncs = allProgress.filter((p) => {
          if (p.status !== "syncing") return false;

          if (p.lastSyncTime) {
            const timeSinceLastSync = Date.now() - new Date(p.lastSyncTime).getTime();
            return timeSinceLastSync > 5 * 60 * 1000;
          }

          return (
            p.progressPercent !== undefined &&
            p.progressPercent > 0 &&
            p.progressPercent < 100
          );
        });

        if (stuckSyncs.length === 0) {
          return;
        }

        const token = TokenStorage.getGlobal();
        if (!token) {
          console.warn("[SyncInitializer] No access token, cannot resume syncs");
          return;
        }

        for (const progress of stuckSyncs) {
          try {
            const dexieChartRepo = new DexieChartBarRepository();
            const api = new CTraderAPI();

            const syncUseCase = new HybridSyncChartBarsUseCase(
              api,
              dexieChartRepo,
              progressRepo
            );

            const fromDate = progress.firstBarDate
              ? new Date(progress.firstBarDate)
              : new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

            const toDate = progress.lastBarDate
              ? new Date(progress.lastBarDate)
              : new Date();

            syncUseCase
              .execute({
                userId: user.id,
                broker: progress.broker,
                symbol: progress.symbol,
                fromDate,
                toDate,
                accessToken: token.accessToken,
              })
              .catch((error) => {
                console.error(
                  `[SyncInitializer] Failed to resume sync for ${progress.symbol}:`,
                  error
                );
              });

            await new Promise((resolve) => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(
              `[SyncInitializer] Error resuming sync for ${progress.symbol}:`,
              error
            );
          }
        }
      } catch (error) {
        console.error("[SyncInitializer] Error checking for stuck syncs:", error);
      }
    };

    const runReconnectFlow = async () => {
      if (!user?.id || !isOnline()) return;
      if (reconnectFlowRunningRef.current) return;
      reconnectFlowRunningRef.current = true;
      try {
        startSync("Pulling latest cloud changes...");
        const reconnectSync = new JournalDeltaSyncService(user.id);
        const result = await reconnectSync.runReconnectFlow((step) => reportStep(step));
        if (!result.success) {
          console.warn("[SyncInitializer] Reconnect flow finished with issues:", result);
        }
        await reconcileSeededJournalDuplicates();
      } catch (error) {
        console.warn("[SyncInitializer] Reconnect flow failed:", error);
      } finally {
        reconnectFlowRunningRef.current = false;
        finishSync();
      }
    };

    const unsubscribe = onConnectionChange((online) => {
      if (online && user?.id) {
        void resumeStuckSyncs();
        void runReconnectFlow();
      }
    });

    if (isOnline() && user?.id) {
      void resumeStuckSyncs();
      void runReconnectFlow();
    }

    return () => {
      unsubscribe();
    };
  }, [user?.id, progressRepo, startSync, reportStep, finishSync]);

  return null;
}
