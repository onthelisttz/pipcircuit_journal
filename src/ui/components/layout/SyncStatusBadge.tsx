"use client";

import { RefreshCw } from "lucide-react";

import { useOnlineStatus } from "@ui/hooks";
import { useFullSyncProgressStore } from "@ui/state";

export function SyncStatusBadge() {
  const isOnline = useOnlineStatus();
  const { isSyncing, syncStep, lastStep } = useFullSyncProgressStore();

  const onlineLabel = isOnline ? "Online" : "Offline";
  const indicatorClass = isOnline ? "bg-emerald-500" : "bg-rose-500";

  const title = isSyncing
    ? syncStep ?? "Sync in progress…"
    : lastStep
    ? `Last sync: ${lastStep}`
    : isOnline
    ? "Online & synced"
    : "Offline (changes pending)";

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
      text-muted-foreground hover:bg-accent hover:text-accent-foreground
      transition-colors duration-150"
      title={title}
    >
      <span className={`h-2 w-2 rounded-full ${indicatorClass}`} aria-hidden />
      <RefreshCw className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">
        {isSyncing ? "Syncing…" : onlineLabel}
      </span>
      {!isSyncing && lastStep && (
        <span className="hidden lg:inline text-xs text-muted-foreground max-w-xs truncate">
          {lastStep}
        </span>
      )}
    </div>
  );
}
