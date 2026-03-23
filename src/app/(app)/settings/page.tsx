"use client";

import { useState } from "react";
import { ChartDataSyncSection } from "@ui/components/settings/ChartDataSyncSection";
import { DataSyncSection } from "@ui/components/settings/DataSyncSection";
import { Mt5HistoryPathSection } from "@ui/components/settings/Mt5HistoryPathSection";

export default function SettingsPage() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<string | null>(null);

  const handleRefreshUi = async () => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      window.location.reload();
      return;
    }

    setIsRefreshing(true);
    setRefreshStatus(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
      if (registration?.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      window.location.reload();
    } catch {
      setRefreshStatus("Refresh failed. Please hard reload the page.");
      setIsRefreshing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure app preferences and manage data synchronization
        </p>
      </div>

      <div className="space-y-8">
        <DataSyncSection />
        <ChartDataSyncSection />
        <Mt5HistoryPathSection />
        <section className="rounded-xl border border-border bg-card/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Refresh App UI</h2>
              <p className="text-xs text-muted-foreground">
                Reload cached assets to pick up the latest UI changes.
              </p>
              {refreshStatus && (
                <p className="mt-2 text-xs text-amber-400">{refreshStatus}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleRefreshUi}
              disabled={isRefreshing}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
            >
              {isRefreshing ? "Refreshing..." : "Refresh UI"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
