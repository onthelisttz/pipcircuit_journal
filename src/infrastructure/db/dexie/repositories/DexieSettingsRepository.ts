import type { ISettingsRepository, SettingRecord } from "@application/ports/repositories";
import { db } from "../database";

export class DexieSettingsRepository implements ISettingsRepository {
  async get(key: string): Promise<SettingRecord | null> {
    return (await db.settings.get(key)) ?? null;
  }

  async set(record: SettingRecord): Promise<void> {
    await db.settings.put(record);
  }

  async remove(key: string): Promise<void> {
    await db.settings.delete(key);
  }

  async list(): Promise<SettingRecord[]> {
    return db.settings.toArray();
  }
}
