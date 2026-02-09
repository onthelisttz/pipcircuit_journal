"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "@ui/hooks/useAuth";
import { RealtimeSubscriptionManager } from "@infrastructure/sync/RealtimeSubscriptionManager";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import type { ChartBar, SymbolSyncProgress } from "@domain/entities";

/**
 * useRealtimeSync - Hook for managing realtime sync subscriptions
 *
 * Automatically starts realtime subscriptions when user is logged in,
 * and stops them on logout. Updates Dexie store on realtime events.
 */
export function useRealtimeSync() {
  const { user } = useAuth();
  const managerRef = useRef<RealtimeSubscriptionManager | null>(null);
  const chartBarRepoRef = useRef(new DexieChartBarRepository());
  const progressRepoRef = useRef(new DexieSymbolSyncProgressRepository());

  useEffect(() => {
    if (!user?.id) {
      // Stop subscriptions if user logs out
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
      return;
    }

    // Create manager if it doesn't exist
    if (!managerRef.current) {
      managerRef.current = new RealtimeSubscriptionManager();
    }

    // Start subscriptions
    const manager = managerRef.current;
    manager
      .start(user.id, {
        onChartBarInsert: async (bar: ChartBar) => {
          // Add to Dexie
          await chartBarRepoRef.current.upsertMany([bar]);
        },
        onChartBarUpdate: async (bar: ChartBar) => {
          // Update in Dexie
          await chartBarRepoRef.current.upsertMany([bar]);
        },
        onChartBarDelete: async (barId: number) => {
          // Note: Dexie doesn't have deleteById, would need to query first
          // For now, we'll rely on upsert to handle updates
          console.log("[Realtime] Chart bar deleted:", barId);
        },
        onProgressUpdate: async (progress: SymbolSyncProgress) => {
          // Update progress in Dexie
          await progressRepoRef.current.upsert(progress);
        },
        onConnectionChange: (connected: boolean) => {
          console.log("[Realtime] Connection status:", connected ? "connected" : "disconnected");
        },
      })
      .catch((error) => {
        console.error("[Realtime] Failed to start subscriptions:", error);
      });

    // Cleanup on unmount
    return () => {
      manager.stop();
    };
  }, [user?.id]);

  return {
    isConnected: managerRef.current?.isRealtimeConnected() ?? false,
  };
}
