"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createSettingsRepository } from "@infrastructure/db/createDualRepositories";
import { MT5_HISTORY_ROOT_SETTING_KEY } from "@lib/mt5";
import { useAuth } from "@ui/hooks/useAuth";

export function Mt5HistoryPathSection() {
  const { user } = useAuth();
  const settingsRepo = useMemo(() => createSettingsRepository(user?.id), [user?.id]);
  const [value, setValue] = useState("");
  const [savedValue, setSavedValue] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setStatus(null);
      try {
        const record = await settingsRepo.get(MT5_HISTORY_ROOT_SETTING_KEY);
        if (cancelled) return;
        const nextValue = typeof record?.value === "string" ? record.value : "";
        setValue(nextValue);
        setSavedValue(nextValue);
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "Failed to load MT5 history path."
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
    const trimmed = value.trim();
    setIsSaving(true);
    setStatus(null);
    try {
      if (trimmed) {
        await settingsRepo.set({
          key: MT5_HISTORY_ROOT_SETTING_KEY,
          value: trimmed,
        });
      } else {
        await settingsRepo.remove(MT5_HISTORY_ROOT_SETTING_KEY);
      }
      setSavedValue(trimmed);
      setValue(trimmed);
      setStatus(trimmed ? "MT5 history path saved." : "MT5 history path cleared.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Failed to save MT5 history path."
      );
    } finally {
      setIsSaving(false);
    }
  }, [settingsRepo, value]);

  const isDirty = value.trim() !== savedValue.trim();

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">MT5 History</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Set the MetaTrader 5 history folder this device should read for the MT5 History chart.
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
            value={value}
            onChange={(event) => setValue(event.target.value)}
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
