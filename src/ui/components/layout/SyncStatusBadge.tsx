"use client";

import { RefreshCw } from "lucide-react";

import { useEntityQueueStatus, useOnlineStatus } from "@ui/hooks";
import { useFullSyncProgressStore } from "@ui/state";

export function SyncStatusBadge() {
  const isOnline = useOnlineStatus();
  const { status } = useEntityQueueStatus();
  const { isSyncing, syncStep } = useFullSyncProgressStore();
  const isActivelySyncing = isSyncing && isOnline;

  const queued = status.pending + status.retrying + status.syncing;
  const hasFailures = status.failed > 0;

  const indicatorClass = !isOnline
    ? "bg-rose-500"
    : hasFailures
    ? "bg-rose-500"
    : queued > 0
    ? "bg-sky-500"
    : "bg-emerald-500";

  const label = !isOnline
    ? queued > 0
      ? `Offline - ${queued} queued`
      : "Offline"
    : isActivelySyncing
    ? "Syncing..."
    : hasFailures
    ? `${status.failed} failed`
    : queued > 0
    ? `${queued} queued`
    : "Completed";

  const title = !isOnline
    ? queued > 0
      ? `Offline with ${queued} queued changes`
      : "Offline"
    : isActivelySyncing
    ? syncStep ?? "Sync in progress..."
    : hasFailures
    ? `Outbox has ${status.failed} failed jobs`
    : queued > 0
    ? `Outbox pending: ${queued} (${status.pending} pending, ${status.retrying} retrying, ${status.syncing} syncing)`
    : "Completed";

  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-accent-foreground"
      title={title}
    >
      <span className={`h-2 w-2 rounded-full ${indicatorClass}`} aria-hidden />
      <RefreshCw className={`h-4 w-4 ${isActivelySyncing ? "animate-spin" : ""}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  );
}
