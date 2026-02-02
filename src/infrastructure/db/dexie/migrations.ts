import type { AppDexie } from "./database";
import { DEXIE_SCHEMA_V1 } from "./schema";

export function registerMigrations(db: AppDexie): void {
  db.version(1).stores(DEXIE_SCHEMA_V1);
}
