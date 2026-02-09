import Dexie, { type Table } from "dexie";

import type {
  Account,
  ChartBar,
  DailySummary,
  Observation,
  ObservationCategory,
  SyncJob,
  SymbolSyncProgress,
  Tag,
  Trade,
  TradeNote,
  TradeTag,
} from "@domain/entities";
import { registerMigrations } from "./migrations";

export interface SyncMetaRecord {
  /** Composite key: userId:accountId */
  key: string;
  userId: string;
  accountId: string;
  lastSyncTime?: Date;
  lastTradeId?: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export class AppDexie extends Dexie {
  trades!: Table<Trade, number>;
  trade_notes!: Table<TradeNote, number>;
  tags!: Table<Tag, number>;
  trade_tags!: Table<TradeTag, number>;
  observations!: Table<Observation, number>;
  observation_categories!: Table<ObservationCategory, number>;
  chart_bars!: Table<ChartBar, number>;
  accounts!: Table<Account, number>;
  sync_queue!: Table<SyncJob, number>;
  sync_meta!: Table<SyncMetaRecord, string>;
  symbol_sync_progress!: Table<SymbolSyncProgress, number>;
  settings!: Table<SettingRecord, string>;
  daily_summaries!: Table<DailySummary, number>;

  constructor() {
    super("smart_trading_journal");
    registerMigrations(this);
  }
}

export const db = new AppDexie();
