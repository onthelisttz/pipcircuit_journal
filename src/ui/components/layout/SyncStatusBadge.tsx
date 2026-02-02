"use client";

import { RefreshCw } from "lucide-react";

import { useOnlineStatus } from "@ui/hooks";

export function SyncStatusBadge() {
    const isOnline = useOnlineStatus();
    const label = isOnline ? "Online" : "Offline";
    const indicatorClass = isOnline ? "bg-emerald-500" : "bg-rose-500";

    return (
        <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
      text-muted-foreground hover:bg-accent hover:text-accent-foreground
      transition-colors duration-150"
            title={isOnline ? "Online & synced" : "Offline (changes pending)"}
        >
            <span className={`h-2 w-2 rounded-full ${indicatorClass}`} aria-hidden />
            <RefreshCw className="w-4 h-4" />
            <span className="hidden sm:inline">{label}</span>
        </div>
    );
}
