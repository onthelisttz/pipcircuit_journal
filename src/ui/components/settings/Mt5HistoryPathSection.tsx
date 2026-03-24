"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import {
  DEFAULT_MT5_LOCAL_SERVICE_URL,
  MT5_HISTORY_ROOT_SETTING_KEY,
  MT5_LOCAL_SERVICE_URL_SETTING_KEY,
} from "@lib/mt5";
import { useAuth } from "@ui/hooks/useAuth";

export function Mt5HistoryPathSection() {
  const { user } = useAuth();
  const settingsRepo = useMemo(() => createSettingsRepository(user?.id), [user?.id]);
  const [historyRootValue, setHistoryRootValue] = useState("");
  const [savedHistoryRootValue, setSavedHistoryRootValue] = useState("");
  const [serviceUrlValue, setServiceUrlValue] = useState("");
  const [savedServiceUrlValue, setSavedServiceUrlValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setStatus(null);
      try {
        const [rootRecord, serviceRecord] = await Promise.all([
          settingsRepo.get(MT5_HISTORY_ROOT_SETTING_KEY),
          settingsRepo.get(MT5_LOCAL_SERVICE_URL_SETTING_KEY),
        ]);
        if (cancelled) return;
        const nextRootValue =
          typeof rootRecord?.value === "string" ? rootRecord.value : "";
        const nextServiceUrl =
          typeof serviceRecord?.value === "string" ? serviceRecord.value : "";
        setHistoryRootValue(nextRootValue);
        setSavedHistoryRootValue(nextRootValue);
        setServiceUrlValue(nextServiceUrl);
        setSavedServiceUrlValue(nextServiceUrl);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "Failed to load MT5 settings."
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [settingsRepo]);

  const handleSave = useCallback(async () => {
    const trimmedRoot = historyRootValue.trim();
    const trimmedServiceUrl = serviceUrlValue.trim();
    setIsSaving(true);
    setStatus(null);
    try {
      if (trimmedRoot) {
        await settingsRepo.set({
          key: MT5_HISTORY_ROOT_SETTING_KEY,
          value: trimmedRoot,
        });
      } else {
        await settingsRepo.remove(MT5_HISTORY_ROOT_SETTING_KEY);
      }

      if (trimmedServiceUrl) {
        await settingsRepo.set({
          key: MT5_LOCAL_SERVICE_URL_SETTING_KEY,
          value: trimmedServiceUrl,
        });
      } else {
        await settingsRepo.remove(MT5_LOCAL_SERVICE_URL_SETTING_KEY);
      }

      setSavedHistoryRootValue(trimmedRoot);
      setHistoryRootValue(trimmedRoot);
      setSavedServiceUrlValue(trimmedServiceUrl);
      setServiceUrlValue(trimmedServiceUrl);
      setStatus("MT5 settings saved.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to save MT5 settings."
      );
    } finally {
      setIsSaving(false);
    }
  }, [historyRootValue, serviceUrlValue, settingsRepo]);

  const isDirty =
    historyRootValue.trim() !== savedHistoryRootValue.trim() ||
    serviceUrlValue.trim() !== savedServiceUrlValue.trim();

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">MT5 History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Run the local MT5 service on this computer, then point the chart to that localhost URL and history folder.
        </p>
      </div>

      <div className="space-y-2.5">
        <label
          htmlFor="mt5-service-url"
          className="text-sm font-medium text-foreground"
        >
          Local service URL
        </label>
        <input
          id="mt5-service-url"
          type="text"
          value={serviceUrlValue}
          onChange={(event) => setServiceUrlValue(event.target.value)}
          placeholder={DEFAULT_MT5_LOCAL_SERVICE_URL}
          disabled={isLoading || isSaving}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-60"
        />
        <p className="text-xs text-muted-foreground">
          Leave blank to use the built-in MT5 reader when the whole app is running locally. For hosted use, set this to something like {DEFAULT_MT5_LOCAL_SERVICE_URL}.
        </p>
      </div>

      <div className="space-y-2.5">
        <label
          htmlFor="mt5-history-root"
          className="text-sm font-medium text-foreground"
        >
          History folder path
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="mt5-history-root"
            type="text"
            value={historyRootValue}
            onChange={(event) => setHistoryRootValue(event.target.value)}
            placeholder="Example: C:\\Users\\costa\\AppData\\Roaming\\MetaQuotes\\Terminal\\...\\bases\\Pepperstone-Demo\\history"
            disabled={isLoading || isSaving}
            className="h-10 flex-1 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isLoading || isSaving || !isDirty}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 sm:min-w-[110px]"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
        </div>
        {status && <p className="text-xs text-muted-foreground">{status}</p>}
      </div>
    </section>
  );
}
