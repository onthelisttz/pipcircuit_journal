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
