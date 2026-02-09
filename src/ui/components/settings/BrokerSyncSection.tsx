"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Play, X } from "lucide-react";
import { useSyncProgress } from "@ui/hooks/useSyncProgress";
import { SymbolSyncItem } from "./SymbolSyncItem";
import type { SymbolSyncProgress } from "@domain/entities";

export interface BrokerSyncSectionProps {
  broker: string;
  symbols: SymbolSyncProgress[];
  onSyncBroker?: (broker: string) => void;
  onSyncSymbol?: (broker: string, symbol: string) => void;
  onContinueSymbol?: (broker: string, symbol: string) => void; // For resuming stuck syncs
  onResetToPending?: (broker: string, symbol: string) => void; // Force reset syncing -> pending
  onRetryFailed?: (broker: string) => void;
  onDeleteBars?: (broker: string, symbol: string) => void; // Delete synced bars and reset
  onCancelBrokerSync?: (broker: string) => void;
  onCancelSymbolSync?: (broker: string, symbol: string) => void;
  isSyncing?: boolean;
  syncingSymbols?: Set<string>;
  deletingSymbols?: Set<string>;
}

export function BrokerSyncSection({
  broker,
  symbols,
  onSyncBroker,
  onSyncSymbol,
  onContinueSymbol,
  onResetToPending,
  onRetryFailed,
  onDeleteBars,
  onCancelBrokerSync,
  onCancelSymbolSync,
  isSyncing = false,
  syncingSymbols = new Set(),
  deletingSymbols = new Set(),
}: BrokerSyncSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  const completed = symbols.filter((s) => s.status === "completed").length;
  const syncing = symbols.filter((s) => s.status === "syncing").length;
  const failed = symbols.filter((s) => s.status === "failed").length;
  const pending = symbols.filter((s) => s.status === "pending").length;

  const totalBars = symbols.reduce((sum, s) => sum + (s.totalBars || 0), 0);

  const hasFailed = failed > 0;
  const hasSyncing = syncing > 0;

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/30">
      {/* Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-gray-500" />
          ) : (
            <ChevronRight className="h-4 w-4 text-gray-500" />
          )}
          <div>
            <h3 className="font-semibold text-gray-100">{broker}</h3>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span>{symbols.length} symbols</span>
              {completed > 0 && (
                <span className="text-green-400">{completed} completed</span>
              )}
              {syncing > 0 && (
                <span className="text-yellow-400">{syncing} syncing</span>
              )}
              {failed > 0 && (
                <span className="text-red-400">{failed} failed</span>
              )}
              {pending > 0 && (
                <span className="text-gray-400">{pending} pending</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {totalBars > 0 && (
            <span className="text-xs text-gray-500">
              {totalBars.toLocaleString()} bars
            </span>
          )}
          {hasFailed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetryFailed?.(broker);
              }}
              className="rounded p-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
              title="Retry failed syncs"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          {!hasSyncing && !isSyncing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSyncBroker?.(broker);
              }}
              disabled={isSyncing}
              className="rounded p-1.5 text-blue-400 hover:bg-blue-400/10 transition-colors disabled:opacity-50"
              title="Sync all symbols"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {isSyncing && (
            <>
              <div className="rounded p-1.5 text-yellow-400">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelBrokerSync?.(broker);
                }}
                className="rounded p-1.5 text-red-400 hover:bg-red-400/10 transition-colors"
                title="Cancel sync"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Symbols List */}
      {isExpanded && (
        <div className="border-t border-gray-800 divide-y divide-gray-800">
          {symbols.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No symbols to sync
            </div>
          ) : (
            symbols.map((symbol) => {
              const symbolKey = `${broker}:${symbol.symbol}`;
              const isSymbolSyncing = syncingSymbols.has(symbolKey);
              const isSymbolDeleting = deletingSymbols.has(symbolKey);
              return (
                <SymbolSyncItem
                  key={symbolKey}
                  progress={symbol}
                  onSync={() => onSyncSymbol?.(broker, symbol.symbol)}
                  onContinue={() => onContinueSymbol?.(broker, symbol.symbol)}
                  onResetToPending={() => onResetToPending?.(broker, symbol.symbol)}
                  onDeleteBars={() => onDeleteBars?.(broker, symbol.symbol)}
                  onCancel={() => onCancelSymbolSync?.(broker, symbol.symbol)}
                  isSyncing={isSymbolSyncing}
                  isDeleting={isSymbolDeleting}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
