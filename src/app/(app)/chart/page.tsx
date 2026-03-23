"use client";

import { useEffect, useState } from "react";
import { Mt5HistoryWorkspace, SyncedChartWorkspace } from "@ui/components/charts";

type ChartMode = "synced" | "history";

const CHART_MODE_KEY = "chartWorkspaceMode";

function readStoredMode(): ChartMode {
  if (typeof window === "undefined") return "synced";
  try {
    const raw = window.localStorage.getItem(CHART_MODE_KEY);
    if (raw === "synced" || raw === "history") {
      return raw;
    }
  } catch {
    // ignore
  }
  return "synced";
}

export default function ChartPage() {
  const [mode, setMode] = useState<ChartMode>(() => readStoredMode());
  const [historyAvailabilityText, setHistoryAvailabilityText] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(CHART_MODE_KEY, mode);
  }, [mode]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Chart</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "synced"
              ? "One workspace for both your synced journal chart and the MT5 history viewer."
              : historyAvailabilityText ?? "Loading MT5 history availability..."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("synced")}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "synced"
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          Synced Chart
        </button>
        <button
          type="button"
          onClick={() => setMode("history")}
          className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
            mode === "history"
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          }`}
        >
          MT5 History
        </button>
      </div>

      {mode === "synced" ? (
        <SyncedChartWorkspace />
      ) : (
        <Mt5HistoryWorkspace onAvailabilityTextChange={setHistoryAvailabilityText} />
      )}
    </div>
  );
}
