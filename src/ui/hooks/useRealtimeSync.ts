"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@ui/hooks/useAuth";
import { RealtimeSubscriptionManager } from "@infrastructure/sync/RealtimeSubscriptionManager";
import { DexieChartBarRepository } from "@infrastructure/db/dexie/repositories";
import { DexieSymbolSyncProgressRepository } from "@infrastructure/db/dexie/repositories";
import { DexieTagRepository } from "@infrastructure/db/dexie/repositories";
import { DexieNoteRepository } from "@infrastructure/db/dexie/repositories";
import { DexieObservationRepository } from "@infrastructure/db/dexie/repositories";
import { SupabaseTradeRepository } from "@infrastructure/db/supabase/repositories/SupabaseTradeRepository";
import { db } from "@infrastructure/db/dexie/database";
import type { ChartBar, SymbolSyncProgress } from "@domain/entities";
import type { TagCategory } from "@domain/enums";

function parseDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (Number.isFinite(date.getTime())) return date;
  }
  return new Date();
}

function parseOptionalDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  return parseDate(value);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

/**
 * useRealtimeSync - Hook for managing realtime sync subscriptions
 *
 * Automatically starts realtime subscriptions when user is logged in,
 * and stops them on logout. Updates Dexie store on realtime events.
 */
export function useRealtimeSync() {
  const { user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const managerRef = useRef<RealtimeSubscriptionManager | null>(null);
  const chartBarRepoRef = useRef(new DexieChartBarRepository());
  const progressRepoRef = useRef(new DexieSymbolSyncProgressRepository());
  const tagRepoRef = useRef(new DexieTagRepository());
  const noteRepoRef = useRef(new DexieNoteRepository());
  const observationRepoRef = useRef(new DexieObservationRepository());

  useEffect(() => {
    if (!user?.id) {
      if (managerRef.current) {
        managerRef.current.stop();
        managerRef.current = null;
      }
      return;
    }

    if (!managerRef.current) {
      managerRef.current = new RealtimeSubscriptionManager();
    }

    const manager = managerRef.current;
    const tradeRepo = new SupabaseTradeRepository(user.id);

    const resolveLocalTradeId = async (remoteTradeId: number): Promise<number | null> => {
      const direct = await db.trades.get(remoteTradeId);
      if (direct?.id != null) {
        return direct.id;
      }

      try {
        const remoteTrade = await tradeRepo.getById(remoteTradeId);
        if (!remoteTrade?.accountId || !remoteTrade.ticketId) {
          return null;
        }
        const candidates = await db.trades
          .where("accountId")
          .equals(remoteTrade.accountId)
          .toArray();
        const match = candidates.find((trade) => trade.ticketId === remoteTrade.ticketId);
        return match?.id ?? null;
      } catch {
        return null;
      }
    };

    const resolveLocalTagId = async (remoteTagId: number): Promise<number | null> => {
      const byRemote = await tagRepoRef.current.getByRemoteId(remoteTagId, true);
      if (byRemote?.id != null) {
        return byRemote.id;
      }

      const byLegacy = await tagRepoRef.current.getByIdIncludingDeleted(remoteTagId);
      if (byLegacy?.id != null) {
        if (byLegacy.remoteId == null) {
          await tagRepoRef.current.update(byLegacy.id, { remoteId: remoteTagId });
        }
        return byLegacy.id;
      }

      return null;
    };

    manager
      .start(user.id, {
        onChartBarInsert: async (bar: ChartBar) => {
          await chartBarRepoRef.current.upsertMany([bar]);
        },
        onChartBarUpdate: async (bar: ChartBar) => {
          await chartBarRepoRef.current.upsertMany([bar]);
        },
        onChartBarDelete: async () => {},
        onProgressUpdate: async (progress: SymbolSyncProgress) => {
          await progressRepoRef.current.upsert(progress);
        },
        onEntityRealtimeEvent: async (event) => {
          try {
            const row = (event.eventType === "DELETE" ? event.oldRow : event.newRow) ?? null;
            if (!row) return;

            if (event.table === "tags") {
              const remoteId = toNumber(row.id);
              const clientId = toStringValue(row.client_id);

              if (event.eventType === "DELETE") {
                if (clientId) await tagRepoRef.current.deleteByClientId(clientId);
                if (remoteId != null) await tagRepoRef.current.deleteByRemoteId(remoteId);
                return;
              }

              if (remoteId == null) return;
              await tagRepoRef.current.upsertFromRemote({
                remoteId,
                clientId,
                name: String(row.name ?? ""),
                category: String(row.category ?? "Custom") as TagCategory,
                color: String(row.color ?? "#6b7280"),
                createdAt: parseDate(row.created_at),
                updatedAt: parseDate(row.updated_at),
                deletedAt: parseOptionalDate(row.deleted_at),
                syncedAt: parseOptionalDate(row.synced_at),
                deviceId: toStringValue(row.device_id) ?? null,
                version: toNumber(row.version) ?? undefined,
              });
              return;
            }

            if (event.table === "trade_notes") {
              const remoteId = toNumber(row.id);
              const clientId = toStringValue(row.client_id);

              if (event.eventType === "DELETE") {
                if (clientId) await noteRepoRef.current.deleteByClientId(clientId);
                if (remoteId != null) await noteRepoRef.current.deleteByRemoteId(remoteId);
                return;
              }

              if (remoteId == null) return;
              const remoteTradeId = toNumber(row.trade_id);
              if (remoteTradeId == null) return;

              const existing = await noteRepoRef.current.getByRemoteId(remoteId, true);
              const localTradeId =
                (await resolveLocalTradeId(remoteTradeId)) ?? existing?.tradeId ?? null;
              const deletedAt = parseOptionalDate(row.deleted_at);

              if (localTradeId == null) {
                if (deletedAt) {
                  if (clientId) await noteRepoRef.current.deleteByClientId(clientId);
                  await noteRepoRef.current.deleteByRemoteId(remoteId);
                }
                return;
              }

              await noteRepoRef.current.upsertFromRemote({
                remoteId,
                clientId,
                tradeId: localTradeId,
                content: String(row.content ?? ""),
                createdAt: parseDate(row.created_at),
                updatedAt: parseDate(row.updated_at),
                deletedAt,
                syncedAt: parseOptionalDate(row.synced_at),
                deviceId: toStringValue(row.device_id) ?? null,
                version: toNumber(row.version) ?? undefined,
              });
              return;
            }

            if (event.table === "observation_categories") {
              const remoteId = toNumber(row.id);
              const clientId = toStringValue(row.client_id);

              if (event.eventType === "DELETE") {
                if (clientId) {
                  await observationRepoRef.current.deleteCategoryByClientId(clientId);
                }
                if (remoteId != null) {
                  await observationRepoRef.current.deleteCategoryByRemoteId(remoteId);
                }
                return;
              }

              if (remoteId == null) return;
              await observationRepoRef.current.upsertCategoryFromRemote({
                remoteId,
                clientId,
                name: String(row.name ?? ""),
                color: String(row.color ?? "#6b7280"),
                createdAt: parseDate(row.created_at),
                updatedAt: parseDate(row.updated_at),
                deletedAt: parseOptionalDate(row.deleted_at),
                syncedAt: parseOptionalDate(row.synced_at),
                deviceId: toStringValue(row.device_id) ?? null,
                version: toNumber(row.version) ?? undefined,
              });
              return;
            }

            if (event.table === "observations") {
              const remoteId = toNumber(row.id);
              const clientId = toStringValue(row.client_id);

              if (event.eventType === "DELETE") {
                if (clientId) await observationRepoRef.current.deleteByClientId(clientId);
                if (remoteId != null) await observationRepoRef.current.deleteByRemoteId(remoteId);
                return;
              }

              if (remoteId == null) return;

              const remoteCategoryId = toNumber(row.category_id);
              const deletedAt = parseOptionalDate(row.deleted_at);
              const existing = await observationRepoRef.current.getByRemoteId(remoteId, true);

              let localCategoryId: number | null = null;
              if (remoteCategoryId != null) {
                const byRemote = await observationRepoRef.current.getCategoryByRemoteId(
                  remoteCategoryId,
                  true
                );
                if (byRemote?.id != null) {
                  localCategoryId = byRemote.id;
                } else {
                  const byLegacy = await observationRepoRef.current.getCategoryByIdIncludingDeleted(
                    remoteCategoryId
                  );
                  if (byLegacy?.id != null) {
                    localCategoryId = byLegacy.id;
                    if (byLegacy.remoteId == null) {
                      await observationRepoRef.current.updateCategory(byLegacy.id, {
                        remoteId: remoteCategoryId,
                      });
                    }
                  }
                }
              }

              if (remoteCategoryId != null && localCategoryId == null && !deletedAt) {
                return;
              }

              await observationRepoRef.current.upsertFromRemote({
                remoteId,
                clientId,
                categoryId: localCategoryId ?? existing?.categoryId ?? null,
                title: String(row.title ?? ""),
                content: String(row.content ?? ""),
                createdAt: parseDate(row.created_at),
                updatedAt: parseDate(row.updated_at),
                deletedAt,
                syncedAt: parseOptionalDate(row.synced_at),
                deviceId: toStringValue(row.device_id) ?? null,
                version: toNumber(row.version) ?? undefined,
              });
              return;
            }

            if (event.table === "trade_tags") {
              const remoteId = toNumber(row.id);
              const clientId = toStringValue(row.client_id);

              if (event.eventType === "DELETE") {
                if (clientId) await tagRepoRef.current.deleteTradeTagByClientId(clientId);
                if (remoteId != null) await tagRepoRef.current.deleteTradeTagByRemoteId(remoteId);
                return;
              }

              if (remoteId == null) return;

              const remoteTradeId = toNumber(row.trade_id);
              const remoteTagId = toNumber(row.tag_id);
              if (remoteTradeId == null || remoteTagId == null) return;

              const localTradeId = await resolveLocalTradeId(remoteTradeId);
              const localTagId = await resolveLocalTagId(remoteTagId);
              const deletedAt = parseOptionalDate(row.deleted_at);

              if (localTradeId == null || localTagId == null) {
                if (deletedAt) {
                  if (clientId) await tagRepoRef.current.deleteTradeTagByClientId(clientId);
                  await tagRepoRef.current.deleteTradeTagByRemoteId(remoteId);
                }
                return;
              }

              await tagRepoRef.current.upsertTradeTagFromRemote({
                remoteId,
                clientId,
                tradeId: localTradeId,
                tagId: localTagId,
                createdAt: parseDate(row.created_at),
                updatedAt: parseOptionalDate(row.updated_at) ?? undefined,
                deletedAt,
                deviceId: toStringValue(row.device_id) ?? null,
                version: toNumber(row.version) ?? undefined,
              });
            }
          } catch (error) {
            console.error("[Realtime] Failed to apply entity event:", error);
          }
        },
        onConnectionChange: (connected: boolean) => {
          setIsConnected(connected);
        },
      })
      .catch((error) => {
        console.error("[Realtime] Failed to start subscriptions:", error);
      });

    return () => {
      manager.stop();
      setIsConnected(false);
    };
  }, [user?.id]);

  return {
    isConnected,
  };
}

