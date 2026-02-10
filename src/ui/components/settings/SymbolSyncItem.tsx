"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { CheckCircle2, Clock, XCircle, AlertCircle, Play, RefreshCw, PlayCircle, RotateCcw, Trash2, X } from "lucide-react";
import type { SymbolSyncProgress } from "@domain/entities";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { SupabaseChartBarRepository } from "@infrastructure/db/supabase/repositories";
import { useAuth } from "@ui/hooks/useAuth";
import { isOnline } from "@infrastructure/sync/utils/connection";

export interface SymbolSyncItemProps {
  progress: SymbolSyncProgress;
  onSync?: () => void;
  onContinue?: () => void; // For resuming stuck syncs
  onResetToPending?: () => void; // Force reset syncing -> pending (for stuck syncs)
  onDeleteBars?: () => void; // Delete synced bars and reset
  onCancel?: () => void; // Cancel sync in progress
  isSyncing?: boolean;
  isDeleting?: boolean;
}

export function SymbolSyncItem({ progress, onSync, onContinue, onResetToPending, onDeleteBars, onCancel, isSyncing = false, isDeleting = false }: SymbolSyncItemProps) {
  const { user } = useAuth();
  const [calculatedDates, setCalculatedDates] = useState<{
    firstBarDate: Date | null;
    lastBarDate: Date | null;
  } | null>(null);
  const [barCounts, setBarCounts] = useState<{
    dexie: number | null;
    supabase: number | null;
  }>({ dexie: null, supabase: null });

  // Calculate dates and counts from existing bars if missing from progress
  useEffect(() => {
    // For completed symbols, always try to calculate dates if they're missing
    // For other statuses, only calculate if totalBars > 0
    const shouldCalculate = 
      progress.status === "completed" 
        ? (!progress.firstBarDate || !progress.lastBarDate)
        : (progress.totalBars > 0 && (!progress.firstBarDate || !progress.lastBarDate));

    if (shouldCalculate || progress.status === "completed") {
      const dexieChartRepo = new DexieChartBarRepository();
      
      // Calculate dates
      if (shouldCalculate) {
        dexieChartRepo
          .getDateRange(progress.broker, progress.symbol, "M1")
          .then((dates) => {
            if (dates.firstBarDate && dates.lastBarDate) {
              setCalculatedDates(dates);
            }
          })
          .catch((error) => {
            console.error(`[SymbolSyncItem] Error calculating dates for ${progress.symbol}:`, error);
          });
      }

      // Always fetch counts for completed symbols
      if (progress.status === "completed") {
        // Count Dexie bars
        dexieChartRepo
          .countBars(progress.broker, progress.symbol, "M1")
          .then((count) => {
            setBarCounts((prev) => ({ ...prev, dexie: count }));
          })
          .catch((error) => {
            console.error(`[SymbolSyncItem] Error counting Dexie bars for ${progress.symbol}:`, error);
          });

        // Count Supabase bars if online
        if (isOnline() && user?.id) {
          const supabaseChartRepo = new SupabaseChartBarRepository(user.id);
          supabaseChartRepo
            .countBars(progress.broker, progress.symbol, "M1")
            .then((count) => {
              setBarCounts((prev) => ({ ...prev, supabase: count }));
            })
            .catch((error) => {
              console.error(`[SymbolSyncItem] Error counting Supabase bars for ${progress.symbol}:`, error);
              setBarCounts((prev) => ({ ...prev, supabase: null }));
            });
        } else {
          setBarCounts((prev) => ({ ...prev, supabase: null }));
        }
      }
    }
  }, [progress.broker, progress.symbol, progress.status, progress.totalBars, progress.firstBarDate, progress.lastBarDate, user?.id]);

  // Check if sync is stuck (syncing but no recent activity for 1+ min)
  const isStuck = progress.status === "syncing" && progress.lastSyncTime && 
    (Date.now() - new Date(progress.lastSyncTime).getTime()) > 60 * 1000; // 1 minute
  const getStatusIcon = () => {
    switch (progress.status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case "syncing":
        return <Clock className="h-4 w-4 animate-pulse text-yellow-400" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-400" />;
      case "pending":
        return <AlertCircle className="h-4 w-4 text-gray-400" />;
    }
  };

  const getStatusColor = () => {
    switch (progress.status) {
      case "completed":
        return "text-green-400";
      case "syncing":
        return "text-yellow-400";
      case "failed":
        return "text-red-400";
      case "pending":
        return "text-gray-400";
    }
  };

  const formatDate = (date: Date | null): string => {
    if (!date) return "—";
    return formatDistanceToNow(date, { addSuffix: true });
  };

  const formatActualDate = (date: Date | null): string => {
    if (!date) return "—";
    return format(new Date(date), "MMMM d, yyyy");
  };

  // Use calculated dates if progress dates are missing
  const firstBarDate = progress.firstBarDate || calculatedDates?.firstBarDate || null;
  const lastBarDate = progress.lastBarDate || calculatedDates?.lastBarDate || null;

  return (
    <div className="p-4 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {getStatusIcon()}
            <span className="font-medium text-foreground">{progress.symbol}</span>
            <span className={`text-xs ${getStatusColor()}`}>
              {progress.status}
            </span>
          </div>

          <div className="space-y-1 text-xs text-muted-foreground">
            {progress.status === "completed" && progress.totalBars > 0 && (
              <div className="font-medium text-green-400">
                Total bars: {progress.totalBars.toLocaleString()}
              </div>
            )}
            {progress.status === "completed" && (barCounts.dexie !== null || barCounts.supabase !== null) && (
              <div className="space-y-0.5 text-gray-400">
                {barCounts.dexie !== null && (
                  <div>
                    Dexie: {barCounts.dexie.toLocaleString()} bars
                  </div>
                )}
                {barCounts.supabase !== null && (
                  <div>
                    Supabase: {barCounts.supabase.toLocaleString()} bars
                  </div>
                )}
                {barCounts.dexie === null && barCounts.supabase === null && (
                  <div className="text-gray-500 italic">Loading counts...</div>
                )}
              </div>
            )}
            {/* Always show date range if available, especially for completed symbols */}
            {firstBarDate && lastBarDate && (
              <div>
                Date range: {formatActualDate(firstBarDate)} → {formatActualDate(lastBarDate)}
              </div>
            )}
            {firstBarDate && !lastBarDate && (
              <div>
                First bar: {formatActualDate(firstBarDate)}
              </div>
            )}
            {lastBarDate && !firstBarDate && (
              <div>
                Last bar: {formatActualDate(lastBarDate)}
              </div>
            )}
            {progress.lastSyncTime && (
              <div>
                Last sync: {formatDate(progress.lastSyncTime)}
              </div>
            )}
            {progress.status !== "completed" && progress.totalBars > 0 && (
              <div>
                Total bars: {progress.totalBars.toLocaleString()}
              </div>
            )}
          </div>

          {progress.error && (
            <div className="mt-2 text-xs text-red-400 bg-red-400/10 rounded p-2">
              {progress.error}
            </div>
          )}

          {progress.status === "syncing" && progress.progressPercent !== undefined && (
            <div className="mt-2 space-y-1">
              <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Progress</span>
                  <span className="text-muted-foreground">{progress.progressPercent}%</span>
              </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-yellow-400 transition-all duration-300"
                  style={{ width: `${progress.progressPercent}%` }}
                />
              </div>
            </div>
          )}
          {isDeleting && (
            <div className="mt-2 flex items-center gap-2 text-xs text-amber-400">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>Deleting bars...</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isSyncing && !isStuck && (
            <>
              <div className="rounded p-1.5 text-yellow-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="rounded p-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
                  title="Cancel sync"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          {(isStuck || (progress.status === "syncing" && !isSyncing)) && (onContinue || onResetToPending) && (
            <>
              {onContinue && (
                <button
                  onClick={onContinue}
                  disabled={isSyncing}
                  className="rounded p-1.5 text-yellow-400 hover:bg-yellow-400/10 transition-colors disabled:opacity-50"
                  title="Restart / continue sync"
                >
                  <PlayCircle className="h-4 w-4" />
                </button>
              )}
              {onResetToPending && (
                <button
                  onClick={onResetToPending}
                  disabled={isSyncing}
                  className="rounded p-1.5 text-gray-400 hover:bg-gray-400/10 transition-colors disabled:opacity-50"
                  title="Reset to pending (clears stuck state)"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              )}
            </>
          )}
          {!isSyncing && progress.status === "failed" && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="rounded p-1.5 text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
              title="Retry sync"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          {!isSyncing && progress.status === "pending" && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="rounded p-1.5 text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
              title="Start sync"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {!isSyncing && progress.status === "completed" && onSync && (
            <button
              onClick={onSync}
              disabled={isSyncing}
              className="rounded p-1.5 text-gray-400 hover:bg-gray-400/10 transition-colors disabled:opacity-50"
              title="Sync new bars (incremental)"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          {!isSyncing && progress.status === "completed" && onDeleteBars && (
            <button
              onClick={onDeleteBars}
              disabled={isSyncing || isDeleting}
              className="rounded p-1.5 text-red-400/80 hover:bg-red-400/10 transition-colors disabled:opacity-50"
              title={isDeleting ? "Deleting..." : "Delete bars and start over"}
            >
              {isDeleting ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
