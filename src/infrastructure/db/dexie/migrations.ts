import type { AppDexie } from "./database";
import { DEXIE_SCHEMA_V1, DEXIE_SCHEMA_V2, DEXIE_SCHEMA_V3, DEXIE_SCHEMA_V4 } from "./schema";

export function registerMigrations(db: AppDexie): void {
  // Initial schema
  db.version(1).stores(DEXIE_SCHEMA_V1);

  // Migration v1 → v2: Add broker field to chart_bars, update sync_meta, add symbol_sync_progress
  db.version(2)
    .stores(DEXIE_SCHEMA_V2)
    .upgrade(async (tx) => {
      console.log("[Migration v2] Starting migration...");

      // 1. Migrate chart_bars: Add broker field
      // For existing bars without broker, we'll set it to "Unknown" initially
      // The sync process will populate it correctly based on account broker
      const chartBars = await tx.table("chart_bars").toCollection().toArray();
      if (chartBars.length > 0) {
        console.log(`[Migration v2] Migrating ${chartBars.length} chart bars...`);

        // Try to derive broker from accounts if possible (future use)
        const accounts = await tx.table("accounts").toCollection().toArray();
        const accountMap = new Map<string, string>();
        for (const account of accounts) {
          if (account.id && (account as any).broker) {
            accountMap.set(String(account.id), (account as any).broker as string);
          }
        }

        const updates = chartBars.map((bar: any) => ({
          ...bar,
          broker: bar.broker || "Unknown", // Will be corrected during sync
          syncedAt: bar.syncedAt || null,
        }));

        await tx.table("chart_bars").bulkPut(updates);
        console.log("[Migration v2] Chart bars migrated");
      }

      // 2. Migrate sync_meta: Convert to new format with userId
      const syncMetaRecords = await tx.table("sync_meta").toCollection().toArray();
      if (syncMetaRecords.length > 0) {
        console.log(`[Migration v2] Migrating ${syncMetaRecords.length} sync_meta records...`);

        // Clear old sync_meta table (we'll recreate with new format on next sync)
        await tx.table("sync_meta").clear();
        console.log("[Migration v2] sync_meta cleared (will be repopulated on next sync)");
      }

      // 3. symbol_sync_progress table is new, no migration needed
      console.log("[Migration v2] Migration completed successfully");
    });

  // v3: Keep same structure as V2 but add back the old [symbol+timeframe+timestamp] index
  // so existing code that still uses that index keeps working.
  db.version(3).stores(DEXIE_SCHEMA_V3);

  // v4: Add table index to sync_queue for Supabase sync queue queries
  db.version(4)
    .stores(DEXIE_SCHEMA_V4)
    .upgrade(async (tx) => {
      console.log("[Migration v4] Adding table index to sync_queue...");
      // No data migration needed, just schema update
      console.log("[Migration v4] Migration completed successfully");
    });
}
