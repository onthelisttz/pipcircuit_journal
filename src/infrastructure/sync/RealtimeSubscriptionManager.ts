import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@infrastructure/db/supabase/client";
import {
  isOnline,
  onConnectionChange,
  reportConnectionFailure,
  reportConnectionSuccess,
} from "./utils/connection";

export interface RealtimeCallbacks {
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

/**
 * RealtimeSubscriptionManager - Manages Supabase Realtime subscriptions
 *
 * Subscribes only to journal entity tables.
 */
export class RealtimeSubscriptionManager {
  private supabase: SupabaseClient;
  private subscriptions: Map<string, RealtimeChannel> = new Map();
  private isConnected = false;
  private userId: string | null = null;
  private callbacks: RealtimeCallbacks = {};
  private connectionUnsubscribe?: () => void;
  private reconnectTimeout?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  constructor() {
    this.supabase = getSupabaseClient();

    this.connectionUnsubscribe = onConnectionChange((online) => {
      if (online && this.userId && !this.isConnected) {
        this.start(this.userId, this.callbacks).catch(console.error);
      } else if (!online) {
        this.stop();
      }
    });
  }

  /**
   * Start realtime subscriptions for a user.
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
      await this.subscribeToJournalEntities(userId);
      this.isConnected = true;
      this.callbacks.onConnectionChange?.(true);
    } catch (error) {
      console.error("[Realtime] Failed to start subscriptions:", error);
      this.scheduleReconnect();
    }
  }

  /**
   * Stop all realtime subscriptions.
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
   * Subscribe to journal table changes (notes/tags/observations).
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

  private handleChannelIssue(label: string, status: string, err?: Error): void {
    const details =
      err?.message?.trim() || (err ? JSON.stringify(err) : "") || "No additional details";
    console.warn(`[Realtime] ${label} subscription ${status}: ${details}`);
    reportConnectionFailure(120000);
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
   * Schedule reconnection attempt.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[Realtime] Max reconnect attempts reached");
      return;
    }

    if (this.reconnectTimeout) {
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = undefined;
      if (this.userId && isOnline()) {
        try {
          await this.start(this.userId, this.callbacks);
          this.reconnectAttempts = 0;
        } catch (error) {
          console.error("[Realtime] Reconnect failed:", error);
          this.scheduleReconnect();
        }
      }
    }, delay);
  }

  /**
   * Check if currently connected.
   */
  isRealtimeConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.stop();
    this.connectionUnsubscribe?.();
  }
}
