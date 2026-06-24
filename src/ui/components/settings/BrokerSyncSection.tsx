"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Play,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
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
  onRefetchRange?: (progress: SymbolSyncProgress) => void;
  onCancelBrokerSync?: (broker: string) => void;
  onCancelSymbolSync?: (broker: string, symbol: string) => void;
  onToggleDisabledSymbol?: (broker: string, symbol: string) => void;
  onToggleShowDisabled?: () => void;
  isSyncing?: boolean;
  syncingSymbols?: Set<string>;
  deletingSymbols?: Set<string>;
  disabledSymbolKeys?: Set<string>;
  showDisabledSymbols?: boolean;
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
  onRefetchRange,
  onCancelBrokerSync,
  onCancelSymbolSync,
  onToggleDisabledSymbol,
  onToggleShowDisabled,
  isSyncing = false,
  syncingSymbols = new Set(),
  deletingSymbols = new Set(),
  disabledSymbolKeys = new Set(),
  showDisabledSymbols = true,
}: BrokerSyncSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const isSymbolDisabled = (symbol: string) =>
    disabledSymbolKeys.has(`${broker}:${symbol}`);
  const activeSymbols = symbols.filter((s) => !isSymbolDisabled(s.symbol));
  const visibleSymbols = showDisabledSymbols
    ? symbols
    : symbols.filter((s) => !isSymbolDisabled(s.symbol));
  const disabled = symbols.length - activeSymbols.length;

  const completed = activeSymbols.filter(
    (s) => s.status === "completed",
  ).length;
  const syncing = activeSymbols.filter((s) => s.status === "syncing").length;
  const failed = activeSymbols.filter((s) => s.status === "failed").length;
  const pending = activeSymbols.filter((s) => s.status === "pending").length;

  const totalBars = symbols.reduce((sum, s) => sum + (s.totalBars || 0), 0);

  const hasFailed = failed > 0;
  const hasSyncing = syncing > 0;
  const hasActiveSymbols = activeSymbols.length > 0;

  return (
    <div className="rounded-lg border border-border bg-muted/40">
      {/* Header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 cursor-pointer hover:bg-accent/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <div>
            <h3 className="font-semibold text-foreground">{broker}</h3>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span>{symbols.length} symbols</span>
              {completed > 0 && (
                <span className="text-emerald-500">{completed} completed</span>
              )}
              {syncing > 0 && (
                <span className="text-amber-500">{syncing} syncing</span>
              )}
              {failed > 0 && (
                <span className="text-destructive">{failed} failed</span>
              )}
              {pending > 0 && (
                <span className="text-muted-foreground">{pending} pending</span>
              )}
              {disabled > 0 && (
                <span className="text-muted-foreground">
                  {disabled} disabled
                </span>
              )}
            </div>
          </div>
        </div>

        <div
          className="flex items-center gap-2 sm:self-auto sm:justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          {totalBars > 0 && (
            <span className="text-xs text-muted-foreground">
              {totalBars.toLocaleString()} bars
            </span>
          )}
          {hasFailed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRetryFailed?.(broker);
              }}
              className="rounded p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
              title="Retry failed syncs"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          )}
          {disabled > 0 && onToggleShowDisabled && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleShowDisabled();
              }}
              className="rounded p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
              title={
                showDisabledSymbols
                  ? "Hide disabled symbols"
                  : "Show disabled symbols"
              }
              aria-label={
                showDisabledSymbols
                  ? "Hide disabled symbols"
                  : "Show disabled symbols"
              }
            >
              {showDisabledSymbols ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          )}
          {!hasSyncing && !isSyncing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSyncBroker?.(broker);
              }}
              disabled={isSyncing || !hasActiveSymbols}
              className="rounded p-1.5 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50"
              title={
                hasActiveSymbols
                  ? "Sync enabled symbols"
                  : "No enabled symbols to sync"
              }
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {isSyncing && (
            <>
              <div className="rounded p-1.5 text-amber-500">
                <RefreshCw className="h-4 w-4 animate-spin" />
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCancelBrokerSync?.(broker);
                }}
                className="rounded p-1.5 text-destructive hover:bg-destructive/10 transition-colors"
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
        <div className="border-t border-border/60 divide-y divide-border/60">
          {visibleSymbols.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {symbols.length === 0
                ? "No symbols to sync"
                : "Disabled symbols are hidden"}
            </div>
          ) : (
            visibleSymbols.map((symbol) => {
              const symbolKey = `${broker}:${symbol.symbol}`;
              const isSymbolSyncing = syncingSymbols.has(symbolKey);
              const isSymbolDeleting = deletingSymbols.has(symbolKey);
              const isDisabled = disabledSymbolKeys.has(symbolKey);
              return (
                <SymbolSyncItem
                  key={symbolKey}
                  progress={symbol}
                  onSync={() => onSyncSymbol?.(broker, symbol.symbol)}
                  onContinue={() => onContinueSymbol?.(broker, symbol.symbol)}
                  onResetToPending={() =>
                    onResetToPending?.(broker, symbol.symbol)
                  }
                  onDeleteBars={() => onDeleteBars?.(broker, symbol.symbol)}
                  onRefetchRange={() => onRefetchRange?.(symbol)}
                  onCancel={() => onCancelSymbolSync?.(broker, symbol.symbol)}
                  onToggleDisabled={() =>
                    onToggleDisabledSymbol?.(broker, symbol.symbol)
                  }
                  isSyncing={isSymbolSyncing}
                  isDeleting={isSymbolDeleting}
                  isDisabled={isDisabled}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
