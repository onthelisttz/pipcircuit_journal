import type { ISettingsRepository, SettingRecord } from "@application/ports/repositories";
import { isOnline } from "@infrastructure/sync/utils/connection";

/**
 * Dual repository: reads from Dexie, writes to Dexie + Supabase (when online).
 * Real-time sync for settings.
 */
export class DualSettingsRepository implements ISettingsRepository {
  constructor(
    private readonly dexie: ISettingsRepository,
    private readonly supabase: ISettingsRepository | null
  ) {}

  private async syncToSupabase<T>(fn: () => Promise<T>): Promise<void> {
    if (this.supabase && isOnline()) {
      try {
        await fn();
      } catch (err) {
        console.warn("[DualSettingsRepo] Supabase sync failed (Dexie updated):", err);
      }
    }
  }

  async get(key: string): Promise<SettingRecord | null> {
    return this.dexie.get(key);
  }

  async set(record: SettingRecord): Promise<void> {
    await this.dexie.set(record);
    await this.syncToSupabase(() => this.supabase!.set(record));
  }

  async remove(key: string): Promise<void> {
    await this.dexie.remove(key);
    await this.syncToSupabase(() => this.supabase!.remove(key));
  }

  async list(): Promise<SettingRecord[]> {
    return this.dexie.list();
  }
}
