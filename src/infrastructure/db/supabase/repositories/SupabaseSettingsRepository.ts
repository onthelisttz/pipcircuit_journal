import type { ISettingsRepository, SettingRecord } from "@application/ports/repositories";
import { getSupabaseClient } from "../client";

export class SupabaseSettingsRepository implements ISettingsRepository {
  constructor(private readonly userId: string) {}

  async get(key: string): Promise<SettingRecord | null> {
    const { data, error } = await getSupabaseClient()
      .from("settings")
      .select("key, value")
      .eq("user_id", this.userId)
      .eq("key", key)
      .single();

    if (error || !data) return null;
    return {
      key: (data as { key: string }).key,
      value: (data as { value: unknown }).value,
    };
  }

  async set(record: SettingRecord): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("settings")
      .upsert(
        {
          user_id: this.userId,
          key: record.key,
          value: record.value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,key", ignoreDuplicates: false }
      );

    if (error) throw new Error(`Failed to set setting: ${error.message}`);
  }

  async remove(key: string): Promise<void> {
    const { error } = await getSupabaseClient()
      .from("settings")
      .delete()
      .eq("user_id", this.userId)
      .eq("key", key);

    if (error) throw new Error(`Failed to remove setting: ${error.message}`);
  }

  async list(): Promise<SettingRecord[]> {
    const { data, error } = await getSupabaseClient()
      .from("settings")
      .select("key, value")
      .eq("user_id", this.userId);

    if (error) throw new Error(`Failed to list settings: ${error.message}`);
    return (data ?? []).map((r: { key: string; value: unknown }) => ({ key: r.key, value: r.value }));
  }
}
