export interface SettingRecord {
  key: string;
  value: unknown;
}

export interface ISettingsRepository {
  get(key: string): Promise<SettingRecord | null>;
  set(record: SettingRecord): Promise<void>;
  remove(key: string): Promise<void>;
  list(): Promise<SettingRecord[]>;
}
