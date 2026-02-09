export const DEXIE_SCHEMA_V1 = {
  trades: "++id, accountId, symbol, direction, openTime, closeTime, [symbol+openTime]",
  trade_notes: "++id, tradeId, createdAt",
  tags: "++id, category, name, color",
  trade_tags: "++id, tradeId, tagId, [tradeId+tagId]",
  observations: "++id, categoryId, title, createdAt",
  observation_categories: "++id, name, color",
  chart_bars: "++id, [symbol+timeframe+timestamp], symbol, timeframe",
  accounts: "++id, accountNumber, platform",
  sync_queue: "++id, status, timestamp",
  sync_meta: "accountId, lastSyncTime, lastTradeId",
  settings: "key, value",
  daily_summaries: "++id, accountId, date, [accountId+date]",
};

// V2 introduces broker-based storage and symbol_sync_progress,
// but initially only has the new broker-based index.
export const DEXIE_SCHEMA_V2 = {
  trades: "++id, accountId, symbol, direction, openTime, closeTime, [symbol+openTime]",
  trade_notes: "++id, tradeId, createdAt",
  tags: "++id, category, name, color",
  trade_tags: "++id, tradeId, tagId, [tradeId+tagId]",
  observations: "++id, categoryId, title, createdAt",
  observation_categories: "++id, name, color",
  // Broker-based index for sharing bars across accounts
  chart_bars: "++id, [broker+symbol+timeframe+timestamp], broker, symbol, timeframe, timestamp",
  accounts: "++id, accountNumber, platform",
  sync_queue: "++id, status, timestamp",
  // Composite key userId:accountId
  sync_meta: "key, userId, accountId, lastSyncTime, lastTradeId",
  // Symbol sync progress tracking
  symbol_sync_progress: "++id, [broker+symbol], broker, symbol, status",
  settings: "key, value",
  daily_summaries: "++id, accountId, date, [accountId+date]",
};

// V3 keeps V2 structure but adds back the old symbol+timeframe index
// so existing queries (useChartData, etc.) keep working.
export const DEXIE_SCHEMA_V3 = {
  trades: "++id, accountId, symbol, direction, openTime, closeTime, [symbol+openTime]",
  trade_notes: "++id, tradeId, createdAt",
  tags: "++id, category, name, color",
  trade_tags: "++id, tradeId, tagId, [tradeId+tagId]",
  observations: "++id, categoryId, title, createdAt",
  observation_categories: "++id, name, color",
  // Both new and legacy indexes to keep everything compatible
  chart_bars:
    "++id, [broker+symbol+timeframe+timestamp], [symbol+timeframe+timestamp], broker, symbol, timeframe, timestamp",
  accounts: "++id, accountNumber, platform",
  sync_queue: "++id, status, timestamp",
  sync_meta: "key, userId, accountId, lastSyncTime, lastTradeId",
  symbol_sync_progress: "++id, [broker+symbol], broker, symbol, status",
  settings: "key, value",
  daily_summaries: "++id, accountId, date, [accountId+date]",
};

// V4 adds table index to sync_queue for Supabase sync queue queries
export const DEXIE_SCHEMA_V4 = {
  trades: "++id, accountId, symbol, direction, openTime, closeTime, [symbol+openTime]",
  trade_notes: "++id, tradeId, createdAt",
  tags: "++id, category, name, color",
  trade_tags: "++id, tradeId, tagId, [tradeId+tagId]",
  observations: "++id, categoryId, title, createdAt",
  observation_categories: "++id, name, color",
  chart_bars:
    "++id, [broker+symbol+timeframe+timestamp], [symbol+timeframe+timestamp], broker, symbol, timeframe, timestamp",
  accounts: "++id, accountNumber, platform",
  // Add table index for querying by table name (e.g., "chart_bars" for Supabase sync queue)
  sync_queue: "++id, status, timestamp, table, [table+status]",
  sync_meta: "key, userId, accountId, lastSyncTime, lastTradeId",
  symbol_sync_progress: "++id, [broker+symbol], broker, symbol, status",
  settings: "key, value",
  daily_summaries: "++id, accountId, date, [accountId+date]",
};
