"use client";

import { useEffect, useState, useCallback } from "react";
import { RefreshCw, Cloud, CloudOff } from "lucide-react";
import { useAuth } from "@ui/hooks/useAuth";
import { FullSyncService } from "@infrastructure/sync/FullSyncService";
import { isOnline } from "@infrastructure/sync/utils/connection";
import { useFullSyncProgressStore } from "@ui/state/fullSyncProgressStore";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";

export function DataSyncSection() {
  const { user } = useAuth();
  const [isSyncingLocal, setIsSyncingLocal] = useState(false);
  const [lastSync, setLastSync] = useState<{ success: boolean; error?: string } | null>(null);
  const [autoPushEnabled, setAutoPushEnabled] = useState(false);
  const [autoPushMinutes, setAutoPushMinutes] = useState<number>(10);
  const { syncStep, isSyncing: isSyncingStore, startSync, updateStep, finishSync } =
    useFullSyncProgressStore();

  const isSyncing = isSyncingStore || isSyncingLocal;
  const displayStep = syncStep;

  // Load auto-push settings on mount / user change
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
    startSync("Starting…");

    try {
      const fullSync = new FullSyncService(user.id);
      const result = await fullSync.sync({
        onProgress: (step) => updateStep(step),
      });
      const success = result.push.success && result.pull.success;
      const error = result.push.error ?? result.pull.error;
      setLastSync({ success, error });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLastSync({ success: false, error: msg });
    } finally {
      finishSync();
      setIsSyncingLocal(false);
    }
  }, [user?.id, startSync, updateStep, finishSync]);

  const online = isOnline();

  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="space-y-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-100">Data Sync</h2>
          <p className="mt-1 text-sm text-gray-500">
            Sync trades, accounts, notes, tags, observations, settings, daily summaries, and chart
            sync progress (completed/pending) to the cloud. Chart bar data is synced separately in
            Chart Data Sync.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-2 text-sm text-gray-500">
            {online ? (
              <>
                <Cloud className="h-4 w-4 text-green-500" />
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
            className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`h-4 w-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync now"}
          </button>
        </div>
      </div>

      {/* Auto-push settings */}
      <div className="rounded-lg border border-border bg-muted/40 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-gray-100">Auto-push while online</p>
            <p className="mt-1 text-xs text-gray-500">
              When enabled, local changes are pushed to the cloud automatically while you&apos;re
              online. Full sync still runs on login or when you click &quot;Sync now&quot;.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-gray-600 bg-gray-900"
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

        <div className="mt-3 flex items-center gap-2 text-sm text-gray-300">
          <span className={!autoPushEnabled ? "text-gray-600" : ""}>Every</span>
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
            className="w-20 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-100 disabled:opacity-50"
          />
          <span className={!autoPushEnabled ? "text-gray-600" : ""}>minutes</span>
        </div>
      </div>

      {isSyncing && displayStep && (
        <p className="mt-3 text-sm text-gray-400" data-sync-step>
          {displayStep}
        </p>
      )}

      {lastSync && (
        <div
          className={`mt-4 rounded-lg p-3 text-sm ${
            lastSync.success
              ? "border border-green-800 bg-green-900/20 text-green-300"
              : "border border-red-800 bg-red-900/20 text-red-300"
          }`}
        >
          {lastSync.success ? (
            <p>Sync completed successfully.</p>
          ) : (
            <>
              <p>{lastSync.error ?? "Sync failed."}</p>
              <p className="mt-1 text-xs text-red-200">
                Your local data is still safe. You can keep working offline and try syncing
                again when your connection or Supabase is healthy.
              </p>
            </>
          )}
        </div>
      )}

      {!user?.id && (
        <p className="mt-4 text-sm text-amber-600">
          Log in to sync your data to the cloud and access it on other devices.
        </p>
      )}
    </section>
  );
}
