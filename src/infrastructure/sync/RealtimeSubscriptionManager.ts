import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { ChartBar, SymbolSyncProgress } from "@domain/entities";
import { getSupabaseClient } from "@infrastructure/db/supabase/client";
import { progressEventEmitter } from "./ProgressEventEmitter";
import {
  isOnline,
  onConnectionChange,
  reportConnectionFailure,
  reportConnectionSuccess,
} from "./utils/connection";

export interface RealtimeCallbacks {
  onChartBarInsert?: (bar: ChartBar) => void;
  onChartBarUpdate?: (bar: ChartBar) => void;
  onChartBarDelete?: (barId: number) => void;
  onProgressUpdate?: (progress: SymbolSyncProgress) => void;
  onEntityRealtimeEvent?: (event: {
    table:
      | "tags"
      | "trade_tags"
      | "trade_notes"
      | "observations"
      | "observation_categories";
    eventType: "INSERT" | "UPDATE" | "DELETE";
    newRow: Record<string, unknown> | null;
    oldRow: Record<string, unknown> | null;
  }) => void;
  onConnectionChange?: (connected: boolean) => void;
}

type ChartBarRealtimeRow = {
  id?: number;
  broker?: string;
  symbol?: string;
  timeframe?: ChartBar["timeframe"];
  timestamp?: number;
  open?: number | string;
  high?: number | string;
  low?: number | string;
  close?: number | string;
  volume?: number | string;
  synced_at?: string | null;
};

type SyncProgressRealtimeRow = {
  id?: number;
  broker?: string;
  symbol?: string;
  first_bar_date?: string | null;
  last_bar_date?: string | null;
  last_sync_time?: string | null;
  total_bars?: number | null;
  status?: SymbolSyncProgress["status"];
  error?: string | null;
  progress_percent?: number | null;
};

function asNumber(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asString(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * RealtimeSubscriptionManager - Manages Supabase Realtime subscriptions
 *
 * Handles subscriptions to chart_bars and symbol_sync_progress tables,
 * automatically reconnects on disconnection, and updates local Dexie store.
 */
export class RealtimeSubscriptionManager {
  private supabase: SupabaseClient;
  private subscriptions: Map<string, RealtimeChannel> = new Map();
  private isConnected: boolean = false;
  private userId: string | null = null;
  private callbacks: RealtimeCallbacks = {};
  private connectionUnsubscribe?: () => void;
  private reconnectTimeout?: NodeJS.Timeout;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts = 10;
  /** Set when symbol_sync_progress subscription fails (e.g. Realtime not enabled for table) to avoid retries */
  private skipSyncProgressRealtime: boolean = false;

  constructor() {
    this.supabase = getSupabaseClient();
    
    // Subscribe to connection changes
    this.connectionUnsubscribe = onConnectionChange((online) => {
      if (online && this.userId && !this.isConnected) {
        this.start(this.userId, this.callbacks).catch(console.error);
      } else if (!online) {
        this.stop();
      }
    });
  }

  /**
   * Start realtime subscriptions for a user
   */
  async start(userId: string, callbacks: RealtimeCallbacks = {}): Promise<void> {
    if (!isOnline()) {
      console.warn("[Realtime] Cannot start - offline");
      return;
    }

    if (this.isConnected && this.userId === userId) {
      
      return;
    }

    this.userId = userId;
    this.callbacks = callbacks;
    this.reconnectAttempts = 0;

    try {
      await this.subscribeToChartBars(userId);
      if (!this.skipSyncProgressRealtime) {
        await this.subscribeToSyncProgress(userId);
      } else {
        
      }
      await this.subscribeToJournalEntities(userId);

      this.isConnected = true;
      this.callbacks.onConnectionChange?.(true);
      
    } catch (error) {
      console.error("[Realtime] Failed to start subscriptions:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Stop all realtime subscriptions
   */
  stop(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    const channels = Array.from(this.subscriptions.entries());
    this.subscriptions.clear();

    for (const [key, subscription] of channels) {
      try {
        subscription.unsubscribe();
      } catch (error) {
        console.error(`[Realtime] Error unsubscribing from ${key}:`, error);
      }

      this.removeChannelFromClient(key, subscription);
    }

    this.removeAllChannelsFromClient();
    this.disconnectRealtimeTransport();
    this.isConnected = false;
    this.callbacks.onConnectionChange?.(false);
    
  }

  /**
   * Subscribe to chart_bars table changes
   */
  private async subscribeToChartBars(userId: string): Promise<void> {
    const channel = this.supabase
      .channel(`chart_bars:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chart_bars",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          try {
            const bar = this.mapChartBarFromSupabase(
              (payload.new ?? {}) as ChartBarRealtimeRow
            );
            
            switch (payload.eventType) {
              case "INSERT":
                this.callbacks.onChartBarInsert?.(bar);
                break;
              case "UPDATE":
                this.callbacks.onChartBarUpdate?.(bar);
                break;
              case "DELETE":
                this.callbacks.onChartBarDelete?.(payload.old?.id as number);
                break;
            }
          } catch (error) {
            console.error("[Realtime] Error handling chart_bars event:", error);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          reportConnectionSuccess();
        } else if (status === "CHANNEL_ERROR") {
          this.handleChannelIssue("Chart bars", status, err);
        }
      });

    this.subscriptions.set("chart_bars", channel);
  }

  /**
   * Subscribe to symbol_sync_progress table changes
   */
  private async subscribeToSyncProgress(userId: string): Promise<void> {
    const channel = this.supabase
      .channel(`symbol_sync_progress:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "symbol_sync_progress",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          try {
            const progress = this.mapProgressFromSupabase(
              (payload.new ?? {}) as SyncProgressRealtimeRow
            );
            
            // Emit progress event for store updates
            progressEventEmitter.emit(progress);
            
            this.callbacks.onProgressUpdate?.(progress);
          } catch (error) {
            console.error("[Realtime] Error handling sync_progress event:", error);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          reportConnectionSuccess();
        } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
          const msg = err instanceof Error ? err.message : String(err ?? "");
          if (msg.includes("mismatch") && msg.includes("postgres changes")) {
            this.skipSyncProgressRealtime = true;
            try {
              channel.unsubscribe();
            } catch {}
            this.subscriptions.delete("symbol_sync_progress");
            console.warn(
              "[Realtime] symbol_sync_progress subscription disabled (Realtime may not be enabled for this table in Supabase). Full sync still works."
            );
          } else if (status === "CHANNEL_ERROR") {
            this.handleChannelIssue("Sync progress", status, err);
          } else if (err) {
            console.warn("[Realtime] Sync progress subscription warning", err);
          } else {
            // Benign case: status changed but no error object provided
            console.warn(
              `[Realtime] Sync progress subscription status: ${status} (no error details provided)`
            );
          }
        } else {
          
        }
      });

    this.subscriptions.set("symbol_sync_progress", channel);
  }

  /**
   * Subscribe to journal table changes (notes/tags/observations)
   */
  private async subscribeToJournalEntities(userId: string): Promise<void> {
    const channel = this.supabase
      .channel(`journal_entities:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tags",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          this.callbacks.onEntityRealtimeEvent?.({
            table: "tags",
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            newRow: (payload.new as Record<string, unknown>) ?? null,
            oldRow: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trade_tags",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          this.callbacks.onEntityRealtimeEvent?.({
            table: "trade_tags",
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            newRow: (payload.new as Record<string, unknown>) ?? null,
            oldRow: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "trade_notes",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          this.callbacks.onEntityRealtimeEvent?.({
            table: "trade_notes",
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            newRow: (payload.new as Record<string, unknown>) ?? null,
            oldRow: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "observations",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          this.callbacks.onEntityRealtimeEvent?.({
            table: "observations",
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            newRow: (payload.new as Record<string, unknown>) ?? null,
            oldRow: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "observation_categories",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          this.callbacks.onEntityRealtimeEvent?.({
            table: "observation_categories",
            eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            newRow: (payload.new as Record<string, unknown>) ?? null,
            oldRow: (payload.old as Record<string, unknown>) ?? null,
          });
        }
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") {
          reportConnectionSuccess();
        } else if (status === "CHANNEL_ERROR") {
          this.handleChannelIssue("Journal entities", status, err);
        }
      });

    this.subscriptions.set("journal_entities", channel);
  }

  /**
   * Map Supabase chart bar to domain ChartBar
   */
  private mapChartBarFromSupabase(row: ChartBarRealtimeRow): ChartBar {
    return {
      id: row.id,
      broker: asString(row.broker),
      symbol: asString(row.symbol),
      timeframe: (row.timeframe ?? "M1") as ChartBar["timeframe"],
      timestamp: asNumber(row.timestamp),
      open: asNumber(row.open),
      high: asNumber(row.high),
      low: asNumber(row.low),
      close: asNumber(row.close),
      volume: asNumber(row.volume),
      syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    };
  }

  /**
   * Map Supabase sync progress to domain SymbolSyncProgress
   */
  private mapProgressFromSupabase(row: SyncProgressRealtimeRow): SymbolSyncProgress {
    return {
      id: row.id,
      broker: asString(row.broker),
      symbol: asString(row.symbol),
      firstBarDate: row.first_bar_date ? new Date(row.first_bar_date) : null,
      lastBarDate: row.last_bar_date ? new Date(row.last_bar_date) : null,
      lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : null,
      totalBars: row.total_bars || 0,
      status: row.status ?? "pending",
      error: row.error,
      progressPercent: row.progress_percent ?? undefined,
    };
  }

  private handleChannelIssue(
    label: string,
    status: string,
    err?: Error
  ): void {
    const details =
      err?.message?.trim() ||
      (err ? JSON.stringify(err) : "") ||
      "No additional details";
    console.warn(`[Realtime] ${label} subscription ${status}: ${details}`);
    reportConnectionFailure(120000);
    // Ensure all channels are reset before reconnecting to avoid duplicate listeners.
    this.stop();
    if (!isOnline()) {
      return;
    }
    this.scheduleReconnect();
  }

  private removeChannelFromClient(key: string, channel: RealtimeChannel): void {
    try {
      const removeChannel = (
        this.supabase as unknown as {
          removeChannel?: (value: RealtimeChannel) => Promise<unknown> | unknown;
        }
      ).removeChannel;
      if (typeof removeChannel !== "function") {
        return;
      }
      const result = removeChannel.call(this.supabase, channel);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        void (result as Promise<unknown>).catch((error) => {
          console.warn(`[Realtime] Failed to remove channel ${key}:`, error);
        });
      }
    } catch (error) {
      console.warn(`[Realtime] Failed to remove channel ${key}:`, error);
    }
  }

  private removeAllChannelsFromClient(): void {
    try {
      const removeAllChannels = (
        this.supabase as unknown as {
          removeAllChannels?: () => Promise<unknown> | unknown;
        }
      ).removeAllChannels;
      if (typeof removeAllChannels !== "function") {
        return;
      }
      const result = removeAllChannels.call(this.supabase);
      if (result && typeof (result as Promise<unknown>).catch === "function") {
        void (result as Promise<unknown>).catch((error) => {
          console.warn("[Realtime] Failed to remove all channels:", error);
        });
      }
    } catch (error) {
      console.warn("[Realtime] Failed to remove all channels:", error);
    }
  }

  private disconnectRealtimeTransport(): void {
    try {
      (
        this.supabase as unknown as {
          realtime?: {
            disconnect?: () => void;
          };
        }
      ).realtime?.disconnect?.();
    } catch (error) {
      console.warn("[Realtime] Failed to disconnect realtime transport:", error);
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Realtime] Max reconnect attempts reached");
      return;
    }

    if (this.reconnectTimeout) {
      return; // Already scheduled
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000); // Exponential backoff, max 30s
    this.reconnectAttempts++;

    

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = undefined;
      if (this.userId && isOnline()) {
        try {
          await this.start(this.userId, this.callbacks);
          this.reconnectAttempts = 0; // Reset on success
        } catch (error) {
          console.error("[Realtime] Reconnect failed:", error);
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Check if currently connected
   */
  isRealtimeConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.stop();
    this.connectionUnsubscribe?.();
  }
}
