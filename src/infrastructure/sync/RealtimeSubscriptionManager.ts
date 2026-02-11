import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChartBar, SymbolSyncProgress } from "@domain/entities";
import { getSupabaseClient } from "@infrastructure/db/supabase/client";
import { progressEventEmitter } from "./ProgressEventEmitter";
import { isOnline, onConnectionChange } from "./utils/connection";

export interface RealtimeCallbacks {
  onChartBarInsert?: (bar: ChartBar) => void;
  onChartBarUpdate?: (bar: ChartBar) => void;
  onChartBarDelete?: (barId: number) => void;
  onProgressUpdate?: (progress: SymbolSyncProgress) => void;
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * RealtimeSubscriptionManager - Manages Supabase Realtime subscriptions
 *
 * Handles subscriptions to chart_bars and symbol_sync_progress tables,
 * automatically reconnects on disconnection, and updates local Dexie store.
 */
export class RealtimeSubscriptionManager {
  private supabase: SupabaseClient;
  private subscriptions: Map<string, any> = new Map();
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

    for (const [key, subscription] of this.subscriptions.entries()) {
      try {
        subscription.unsubscribe();
      } catch (error) {
        console.error(`[Realtime] Error unsubscribing from ${key}:`, error);
      }
    }

    this.subscriptions.clear();
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
            const bar = this.mapChartBarFromSupabase(payload.new as any);
            
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          
        } else if (status === "CHANNEL_ERROR") {
          console.error("[Realtime] Chart bars subscription error");
          this.scheduleReconnect();
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
            const progress = this.mapProgressFromSupabase(payload.new as any);
            
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
          
        } else if (status === "CHANNEL_ERROR" || status === "CLOSED") {
          const msg = err instanceof Error ? err.message : String(err ?? "");
          if (msg.includes("mismatch") && msg.includes("postgres changes")) {
            this.skipSyncProgressRealtime = true;
            try {
              channel.unsubscribe();
            } catch (_) {}
            this.subscriptions.delete("symbol_sync_progress");
            console.warn(
              "[Realtime] symbol_sync_progress subscription disabled (Realtime may not be enabled for this table in Supabase). Full sync still works."
            );
          } else if (err) {
            console.error("[Realtime] Sync progress subscription error", err);
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
   * Map Supabase chart bar to domain ChartBar
   */
  private mapChartBarFromSupabase(row: any): ChartBar {
    return {
      id: row.id,
      broker: row.broker,
      symbol: row.symbol,
      timeframe: row.timeframe,
      timestamp: row.timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      syncedAt: row.synced_at ? new Date(row.synced_at) : null,
    };
  }

  /**
   * Map Supabase sync progress to domain SymbolSyncProgress
   */
  private mapProgressFromSupabase(row: any): SymbolSyncProgress {
    return {
      id: row.id,
      broker: row.broker,
      symbol: row.symbol,
      firstBarDate: row.first_bar_date ? new Date(row.first_bar_date) : null,
      lastBarDate: row.last_bar_date ? new Date(row.last_bar_date) : null,
      lastSyncTime: row.last_sync_time ? new Date(row.last_sync_time) : null,
      totalBars: row.total_bars || 0,
      status: row.status,
      error: row.error,
      progressPercent: row.progress_percent ?? undefined,
    };
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
