"use client";

import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, Clock, XCircle, AlertCircle, Loader2 } from "lucide-react";
import type { OverallProgress } from "@ui/state/syncProgressStore";
import { useOverallProgress } from "@ui/hooks/useOverallProgress";

export function SyncStatusCard() {
  const overallProgress = useOverallProgress();

  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    }
    if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toString();
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-100">Chart Data Sync Status</h2>
        {overallProgress.syncingSymbols > 0 && (
          <div className="flex items-center gap-2 text-sm text-blue-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Syncing...</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="space-y-1">
          <div className="text-xs text-gray-500">Total Symbols</div>
          <div className="text-xl font-semibold text-gray-100">
            {overallProgress.totalSymbols}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <CheckCircle2 className="h-3 w-3 text-green-400" />
            Completed
          </div>
          <div className="text-xl font-semibold text-green-400">
            {overallProgress.completedSymbols}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="h-3 w-3 text-yellow-400" />
            Syncing
          </div>
          <div className="text-xl font-semibold text-yellow-400">
            {overallProgress.syncingSymbols}
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <XCircle className="h-3 w-3 text-red-400" />
            Failed
          </div>
          <div className="text-xl font-semibold text-red-400">
            {overallProgress.failedSymbols}
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">Total Bars Synced</span>
          <span className="font-medium text-gray-100">
            {formatNumber(overallProgress.totalBarsSynced)}
          </span>
        </div>

        {overallProgress.totalSymbols > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Overall Progress</span>
              <span className="font-medium text-gray-100">
                {overallProgress.overallProgressPercent}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${overallProgress.overallProgressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
