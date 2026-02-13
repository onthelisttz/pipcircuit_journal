"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Cloud, CloudOff, RotateCcw } from "lucide-react";
import { useAuth } from "@ui/hooks/useAuth";
import { useOnlineStatus } from "@ui/hooks/useOnlineStatus";
import { useEntityQueueStatus } from "@ui/hooks";
import { EntitySyncQueue } from "@infrastructure/sync/EntitySyncQueue";
import { JournalDeltaSyncService } from "@infrastructure/sync/JournalDeltaSyncService";
import { FullSyncService } from "@infrastructure/sync/FullSyncService";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { useFullSyncProgressStore } from "@ui/state/fullSyncProgressStore";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import { db } from "@infrastructure/db/dexie/database";
import { reconcileSeededJournalDuplicates } from "@infrastructure/sync/reconcileSeededJournalDuplicates";

export function DataSyncSection() {
  const { user } = useAuth();
  const online = useOnlineStatus();
  const { status: queueStatus } = useEntityQueueStatus();
  const [isSyncingLocal, setIsSyncingLocal] = useState(false);
  const [lastSync, setLastSync] = useState<{ success: boolean; error?: string } | null>(null);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [isRetryingFailed, setIsRetryingFailed] = useState(false);
  const [autoPushEnabled, setAutoPushEnabled] = useState(false);
  const [autoPushMinutes, setAutoPushMinutes] = useState<number>(10);
  const { syncStep, lastStep, isSyncing: isSyncingStore, startSync, updateStep, finishSync } =
    useFullSyncProgressStore();

  const isSyncing = isSyncingStore || isSyncingLocal;
  const hasCloudStepText =
    (syncStep?.toLowerCase().includes("pull") ?? false) ||
    (syncStep?.toLowerCase().includes("sync") ?? false) ||
    (lastStep?.toLowerCase().includes("pull") ?? false) ||
    (lastStep?.toLowerCase().includes("sync") ?? false);
  const progressMessage =
    !online && (isSyncing || hasCloudStepText)
      ? "Offline. Cloud sync is paused."
      : isSyncing
      ? (syncStep ?? "Sync in progress...")
      : lastStep;

  useEffect(() => {
    if (!user?.id) {
      setAutoPushEnabled(false);
      setAutoPushMinutes(10);
      return;
    }

    let cancelled = false;
    const loadSettings = async () => {
      try {
        const repo = createSettingsRepository(user.id);
        const [enabledRec, minutesRec] = await Promise.all([
          repo.get("sync.autoPushEnabled"),
          repo.get("sync.autoPushIntervalMinutes"),
        ]);

        if (cancelled) return;

        const enabled = enabledRec?.value === true;
        const minutesRaw = typeof minutesRec?.value === "number" ? minutesRec.value : 10;
        const minutes = Number.isFinite(minutesRaw) && minutesRaw > 0 ? minutesRaw : 10;

        setAutoPushEnabled(enabled);
        setAutoPushMinutes(minutes);
      } catch (error) {
        console.warn("[DataSyncSection] Failed to load auto-push settings:", error);
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!online && isSyncing) {
      finishSync();
      setIsSyncingLocal(false);
    }
  }, [finishSync, isSyncing, online]);

  const handleSyncNow = useCallback(async () => {
    if (!user?.id) {
      setLastSync({ success: false, error: "Please log in to sync" });
      return;
    }

    if (!isOnline()) {
      setLastSync({ success: false, error: "Cannot sync while offline" });
      return;
    }

    setIsSyncingLocal(true);
    setLastSync(null);
    setRetryNotice(null);
    startSync("Pulling latest cloud changes...");

    try {
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

      if (localCoreIsEmpty) {
        updateStep("Bootstrapping local data from cloud...");
        const fullSync = new FullSyncService(user.id);
        const pullResult = await fullSync.pullFromSupabase((step) => updateStep(step));
        if (!pullResult.success) {
          setLastSync({
            success: false,
            error: pullResult.error ?? "Initial cloud bootstrap pull failed",
          });
          return;
        }
      }

      const reconnectSync = new JournalDeltaSyncService(user.id);
      const result = await reconnectSync.runReconnectFlow((step) => updateStep(step));

      if (!result.success) {
        setLastSync({
          success: false,
          error: result.error ?? "Sync finished with errors",
        });
        return;
      }

      await reconcileSeededJournalDuplicates();

      setLastSync({ success: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastSync({ success: false, error: msg });
    } finally {
      finishSync();
      setIsSyncingLocal(false);
    }
  }, [user?.id, startSync, updateStep, finishSync]);

  const handleRetryFailed = useCallback(async () => {
    setIsRetryingFailed(true);
    setRetryNotice(null);

    try {
      const retried = await EntitySyncQueue.retryFailed();
      if (retried === 0) {
        setRetryNotice("No failed jobs to retry.");
      } else {
        setRetryNotice(`Moved ${retried} failed job(s) back to pending.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRetryNotice(`Failed to retry jobs: ${message}`);
    } finally {
      setIsRetryingFailed(false);
    }
  }, []);

  const statusCards = [
    {
      key: "pending",
      label: "Pending",
      value: queueStatus.pending,
      tone: "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    },
    {
      key: "retrying",
      label: "Retrying",
      value: queueStatus.retrying,
      tone: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    },
    {
      key: "syncing",
      label: "Syncing",
      value: queueStatus.syncing,
      tone: "border-indigo-500/35 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
    },
    {
      key: "failed",
      label: "Failed",
      value: queueStatus.failed,
      tone: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300",
    },
  ] as const;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Data Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sync notes, tags, observations, and linked trade tags across devices with offline
            outbox replay and conflict-safe reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {online ? (
              <>
                <Cloud className="h-4 w-4 text-emerald-500" />
                Online
              </>
            ) : (
              <>
                <CloudOff className="h-4 w-4 text-amber-500" />
                Offline
              </>
            )}
          </span>
          <button
            onClick={() => void handleSyncNow()}
            disabled={!user?.id || !online || isSyncing}
            className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </div>

      {progressMessage && (
        <div
          className={`rounded-lg border p-4 ${
            isSyncing
              ? "border-sky-500/35 bg-sky-500/10"
              : "border-border bg-muted/30"
          }`}
        >
          <p className="text-sm font-medium text-foreground">
            {isSyncing ? "Current sync step" : "Last sync step"}
          </p>
          <p
            className="mt-1 whitespace-normal break-words text-sm text-muted-foreground"
            data-sync-step-full
          >
            {progressMessage}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Outbox status</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Pending jobs sync automatically when online. Failed jobs stay visible until retried.
            </p>
          </div>
          <button
            onClick={() => void handleRetryFailed()}
            disabled={queueStatus.failed === 0 || isRetryingFailed}
            className="inline-flex items-center gap-2 self-start rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
          >
            <RotateCcw className={`h-3.5 w-3.5 ${isRetryingFailed ? "animate-spin" : ""}`} />
            Retry failed
          </button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          {statusCards.map((card) => (
            <div
              key={card.key}
              className={`rounded-md border px-3 py-2 transition-colors ${card.tone}`}
            >
              <p className="opacity-80">{card.label}</p>
              <p className="mt-1 text-sm font-semibold">{card.value}</p>
            </div>
          ))}
        </div>
        {retryNotice && <p className="mt-3 text-xs text-muted-foreground">{retryNotice}</p>}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-foreground">Auto-push while online</p>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, local changes are pushed to the cloud automatically while you are
              online. Manual sync always runs pull-replay-pull.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border bg-background"
                checked={autoPushEnabled}
                onChange={async (e) => {
                  const enabled = e.target.checked;
                  setAutoPushEnabled(enabled);
                  if (user?.id) {
                    try {
                      const repo = createSettingsRepository(user.id);
                      await repo.set({ key: "sync.autoPushEnabled", value: enabled });
                    } catch (error) {
                      console.warn("[DataSyncSection] Failed to save auto-push enabled:", error);
                    }
                  }
                }}
              />
              <span>Enable</span>
            </label>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <span className={!autoPushEnabled ? "text-muted-foreground/60" : ""}>Every</span>
          <input
            type="number"
            min={1}
            max={240}
            disabled={!autoPushEnabled}
            value={autoPushMinutes}
            onChange={async (e) => {
              const next = Number(e.target.value);
              const minutes =
                Number.isFinite(next) && next > 0 && next <= 240 ? next : autoPushMinutes;
              setAutoPushMinutes(minutes);
              if (user?.id) {
                try {
                  const repo = createSettingsRepository(user.id);
                  await repo.set({ key: "sync.autoPushIntervalMinutes", value: minutes });
                } catch (error) {
                  console.warn("[DataSyncSection] Failed to save auto-push interval:", error);
                }
              }
            }}
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          />
          <span className={!autoPushEnabled ? "text-muted-foreground/60" : ""}>minutes</span>
        </div>
      </div>

      {lastSync && (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            lastSync.success
              ? "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "border border-destructive/40 bg-destructive/10 text-destructive"
          }`}
        >
          {lastSync.success ? (
            <p>Sync completed successfully.</p>
          ) : (
            <>
              <p>{lastSync.error ?? "Sync failed."}</p>
              <p className="mt-1 text-xs text-destructive/80">
                Your local data is still safe. You can keep working offline and retry when the
                connection or cloud service is healthy.
              </p>
            </>
          )}
        </div>
      )}

      {!user?.id && (
        <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">
          Log in to sync your data to the cloud and access it on other devices.
        </p>
      )}
    </section>
  );
}
