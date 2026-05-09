import type { AppDexie } from "./database";
import {
  DEXIE_SCHEMA_V1,
  DEXIE_SCHEMA_V2,
  DEXIE_SCHEMA_V3,
  DEXIE_SCHEMA_V4,
  DEXIE_SCHEMA_V5,
  DEXIE_SCHEMA_V6,
  DEXIE_SCHEMA_V7,
  DEXIE_SCHEMA_V8,
} from "./schema";

export function registerMigrations(db: AppDexie): void {
  // Initial schema
  db.version(1).stores(DEXIE_SCHEMA_V1);

  // Migration v1 → v2: Add broker field to chart_bars, update sync_meta, add symbol_sync_progress
  db.version(2)
    .stores(DEXIE_SCHEMA_V2)
    .upgrade(async (tx) => {
      type MigrationChartBarRow = {
        id?: number;
        broker?: string;
        syncedAt?: Date | null;
      };
      type MigrationAccountRow = {
        id?: number;
        broker?: string;
      };
      

      // 1. Migrate chart_bars: Add broker field
      // For existing bars without broker, we'll set it to "Unknown" initially
      // The sync process will populate it correctly based on account broker
      const chartBars = await tx.table("chart_bars").toCollection().toArray();
      if (chartBars.length > 0) {
        

      // Try to derive broker from accounts if possible (future use)
      const accounts = await tx.table("accounts").toCollection().toArray();
      const accountMap = new Map<string, string>();
      for (const account of accounts as MigrationAccountRow[]) {
        if (account.id && account.broker) {
          accountMap.set(String(account.id), account.broker);
        }
      }

      const updates = (chartBars as MigrationChartBarRow[]).map((bar) => ({
        ...bar,
        broker: bar.broker || "Unknown", // Will be corrected during sync
        syncedAt: bar.syncedAt || null,
        }));

        await tx.table("chart_bars").bulkPut(updates);
        
      }

      // 2. Migrate sync_meta: Convert to new format with userId
      const syncMetaRecords = await tx.table("sync_meta").toCollection().toArray();
      if (syncMetaRecords.length > 0) {
        

        // Clear old sync_meta table (we'll recreate with new format on next sync)
        await tx.table("sync_meta").clear();
        
      }

      // 3. symbol_sync_progress table is new, no migration needed
      
    });

  // v3: Keep same structure as V2 but add back the old [symbol+timeframe+timestamp] index
  // so existing code that still uses that index keeps working.
  db.version(3).stores(DEXIE_SCHEMA_V3);

  // v4: Add table index to sync_queue for Supabase sync queue queries
  db.version(4).stores(DEXIE_SCHEMA_V4);

  // v5: Add remoteId indexes for non-bar entities and queue dedupe indexes
  db.version(5)
    .stores(DEXIE_SCHEMA_V5)
    .upgrade(async (tx) => {
      type RemoteTrackableRow = {
        id?: number;
        remoteId?: number;
        syncedAt?: Date | null;
        version?: number | null;
      };

      // Backfill remoteId for entities that are already known to be synced.
      // We only infer remoteId for rows carrying sync metadata to avoid
      // accidentally linking local-only rows to wrong remote IDs.
      const notes = await tx.table("trade_notes").toCollection().toArray();
      for (const note of notes as RemoteTrackableRow[]) {
        if (note.remoteId == null && note.id != null && (note.syncedAt || note.version != null)) {
          await tx.table("trade_notes").update(note.id, { remoteId: note.id });
        }
      }

      const observations = await tx.table("observations").toCollection().toArray();
      for (const observation of observations as RemoteTrackableRow[]) {
        if (
          observation.remoteId == null &&
          observation.id != null &&
          (observation.syncedAt || observation.version != null)
        ) {
          await tx.table("observations").update(observation.id, { remoteId: observation.id });
        }
      }
    });

  // v6: Add clientId/tombstone metadata indexes + queue diagnostics indexes
  db.version(6)
    .stores(DEXIE_SCHEMA_V6)
    .upgrade(async (tx) => {
      type IdentityRow = {
        id?: number;
        clientId?: string;
        version?: number | null;
        updatedAt?: Date | string | null;
        createdAt?: Date | string | null;
      };

      const createUuid = (): string => {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          return crypto.randomUUID();
        }
        const segment = () =>
          Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .slice(1);
        return `${segment()}${segment()}-${segment()}-${segment()}-${segment()}-${segment()}${segment()}${segment()}`;
      };

      const ensureIdentity = async (tableName: string) => {
        const rows = await tx.table(tableName).toCollection().toArray();
        for (const row of rows as IdentityRow[]) {
          if (row.id == null) continue;
          const updates: Record<string, unknown> = {};

          if (!row.clientId) {
            updates.clientId = createUuid();
          }
          if (row.version == null) {
            updates.version = 1;
          }

          if (Object.keys(updates).length > 0) {
            await tx.table(tableName).update(row.id, updates);
          }
        }
      };

      await ensureIdentity("tags");
      await ensureIdentity("trade_notes");
      await ensureIdentity("observations");
      await ensureIdentity("observation_categories");
      await ensureIdentity("trade_tags");

      // Keep pre-existing stuck jobs retryable after upgrade.
      const queueRows = await tx.table("sync_queue").toCollection().toArray();
      for (const row of queueRows as Array<{ id?: number; status?: string }>) {
        if (row.id == null) continue;
        if (row.status === "Syncing") {
          await tx.table("sync_queue").update(row.id, {
            status: "Pending",
            nextRetryAt: null,
          });
        }
      }
    });

  // v7: add observation source/context metadata for chart-linked observations
  db.version(7)
    .stores(DEXIE_SCHEMA_V7)
    .upgrade(async (tx) => {
      type ObservationRow = {
        id?: number;
        source?: string | null;
        chartContext?: unknown;
      };

      const observations = await tx.table("observations").toCollection().toArray();
      for (const observation of observations as ObservationRow[]) {
        if (observation.id == null) continue;
        const updates: Record<string, unknown> = {};

        if (!observation.source) {
          updates.source = "manual";
        }
        if (!("chartContext" in observation)) {
          updates.chartContext = null;
        }

        if (Object.keys(updates).length > 0) {
          await tx.table("observations").update(observation.id, updates);
        }
      }
    });

  // v8: add local-only chart drawing snapshot storage.
  db.version(8).stores(DEXIE_SCHEMA_V8);
}
