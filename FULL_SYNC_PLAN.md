git # Full Data Sync Plan – Online & Offline Parity

## 1. Goal

Extend sync beyond chart bars so **all app data** works online and offline across devices:
- Local-first (Dexie) for fast reads
- Cloud backup (Supabase) when online
- New device: login → pull from Supabase → full offline experience

---

## 2. Current State

| Data         | Dexie | Supabase | Sync Flow                    |
|--------------|-------|----------|------------------------------|
| Chart bars   | Yes   | Yes      | Dual sync (complete)         |
| Sync progress| Yes   | Yes      | Dual sync (complete)         |
| Trades       | Yes   | No       | Local only                   |
| Accounts     | Yes   | No       | Local only                   |
| Trade notes  | Yes   | No       | Local only                   |
| Tags         | Yes   | No       | Local only                   |
| Trade–tags   | Yes   | No       | Local only                   |
| Observations | Yes   | No       | Local only                   |
| Obs categories| Yes   | No       | Local only                   |
| Settings     | Yes   | No       | Local only                   |
| Daily summaries | Yes | No       | Local only                   |

---

## 3. Target Tables (Supabase Schema)

### 3.1 Tables to Create

| Table                  | Purpose              | Notes                   |
|------------------------|----------------------|-------------------------|
| `trades`               | Trade history        | Full schema below       |
| `accounts`             | Broker accounts      | user_id, account_number, broker, name, etc. |
| `trade_notes`          | Notes per trade      | user_id, trade_id, content, createdAt |
| `tags`                 | Tag definitions      | user_id, name, category, color |
| `trade_tags`           | Trade–tag links      | user_id, trade_id, tag_id |
| `observations`         | Journal entries      | user_id, category_id, title, content |
| `observation_categories` | Obs categories     | user_id, name, color |
| `settings`             | User preferences     | user_id, key, value |
| `daily_summaries`      | Summary stats        | user_id, account_id, date |

### 3.2 Full `trades` Schema (from cTrader + app)

All fields we save from cTrader and the app:

| Field        | Type    | Source   | Description                    |
|--------------|---------|----------|--------------------------------|
| id           | number  | Dexie    | Auto-increment primary key     |
| user_id      | string  | App      | For RLS (add for Supabase)     |
| account_id   | string  | cTrader  | Account number                 |
| ticket_id    | string  | cTrader  | cTrader ticket ID              |
| symbol       | string  | cTrader  | e.g. GBPUSD, US30              |
| direction    | string  | cTrader  | Buy / Sell                     |
| order_type   | string  | cTrader  | Market / Limit / Stop          |
| open_time    | timestamp | cTrader | When trade opened              |
| close_time   | timestamp | cTrader | When trade closed (nullable)   |
| open_price   | number  | cTrader  | Entry price                    |
| close_price  | number  | cTrader  | Exit price (nullable)          |
| entry_price  | number  | cTrader  | Position entry (nullable)      |
| volume       | number  | cTrader  | Trade size                     |
| lots        | number  | cTrader  | Lot size (nullable)            |
| commission   | number  | cTrader  | Commission (nullable)          |
| swap         | number  | cTrader  | Swap (nullable)                |
| fee          | number  | cTrader  | Fee (nullable)                 |
| gross_profit | number  | cTrader  | Gross P&L (nullable)           |
| net_profit   | number  | cTrader  | Net P&L (nullable)              |
| percent_gain | number  | cTrader  | % gain (nullable)              |
| take_profit  | number  | cTrader  | TP level (nullable)             |
| stop_loss    | number  | cTrader  | SL level (nullable)            |
| placed_by    | string  | cTrader  | Algo / Dealer / Manual / Mobile |
| outcome      | string  | cTrader  | TakeProfit / StopLoss / etc.   |
| rating       | number  | App      | User rating (nullable)         |
| mindset      | string  | App      | User mindset (nullable)       |
| comment      | string  | App/cTrader | Comment (nullable)          |
| created_at   | timestamp | App    | Record created                 |
| updated_at   | timestamp | App    | Record updated                 |
| synced_at    | timestamp | App    | Last sync time (nullable)     |
| version      | number  | App      | Optimistic lock (nullable)     |

### 3.3 Full `accounts` Schema (from cTrader + app)

| Field             | Type      | Source   | Description                    |
|-------------------|-----------|----------|--------------------------------|
| id                | number    | Dexie    | Auto-increment                 |
| user_id           | string    | App      | For RLS (add for Supabase)     |
| ctrader_account_id| number    | cTrader  | cTrader numeric ID (nullable)  |
| account_number    | string    | cTrader  | Account number                 |
| platform          | string    | App      | e.g. cTrader                   |
| broker            | string    | cTrader  | Broker name (nullable)         |
| server            | string    | cTrader  | Server (nullable)              |
| name              | string    | cTrader  | Account name (nullable)         |
| type              | string    | cTrader  | Demo / Live (nullable)         |
| currency          | string    | cTrader  | Account currency (nullable)   |
| balance           | number    | cTrader  | Balance (nullable)             |
| equity            | number    | cTrader  | Equity (nullable)             |
| leverage          | number    | cTrader  | Leverage (nullable)            |
| is_active         | boolean   | App      | Active flag (nullable)         |
| last_sync_at      | timestamp | App      | Last sync (nullable)           |
| created_at        | timestamp | App      | Record created                 |
| updated_at        | timestamp | App      | Record updated                 |

### 3.2 RLS (Row Level Security)

- All tables: `user_id = auth.uid()`
- Enables multi-tenant isolation

---

## 4. Sync Architecture

### 4.1 Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         WRITE PATH                               │
├─────────────────────────────────────────────────────────────────┤
│  App action → Dexie (immediate) → Supabase (when online)         │
│                     ↓                                            │
│              If Supabase fails → Queue for retry                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                         READ PATH                                │
├─────────────────────────────────────────────────────────────────┤
│  App query → Dexie (always, fast)                                 │
│  On new device / empty Dexie → Pull from Supabase → Dexie         │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SOURCES (cTrader)                    │
├─────────────────────────────────────────────────────────────────┤
│  Trades: cTrader API → Dexie → Supabase                           │
│  Accounts: cTrader API → Dexie → Supabase                         │
│  Chart bars: (already implemented)                                │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Dual Repository Pattern

For each table, create a dual repository that:
1. **Reads** from Dexie (single source for reads)
2. **Writes** to Dexie first, then Supabase (when online)
3. **On Supabase failure** → queue for retry (reuse `SupabaseSyncQueue` or extend)

### 4.3 Initial Sync (New Device)

On login when Dexie is empty or stale:
1. Fetch all user data from Supabase
2. Bulk insert into Dexie
3. App works offline from that point

---

## 5. Implementation Phases

### Phase 1: Foundation (Week 1)

| Task | Description |
|------|-------------|
| 1.1 | Create Supabase migrations for all tables (user_id, RLS) |
| 1.2 | Create Supabase repositories for each table (mirror Dexie interfaces) |
| 1.3 | Define sync queue schema for generic retries (beyond chart_bars) |

### Phase 2: Trades & Accounts (Week 2)

| Task | Description |
|------|-------------|
| 2.1 | Dual repository: Trades (Dexie + Supabase) |
| 2.2 | Dual repository: Accounts |
| 2.3 | Wire trade import (cTrader) to write to both |
| 2.4 | Initial sync: pull trades + accounts from Supabase on login |

### Phase 3: Trade-Related Data (Week 3)

| Task | Description |
|------|-------------|
| 3.1 | Dual repository: Trade notes |
| 3.2 | Dual repository: Tags |
| 3.3 | Dual repository: Trade–tags |
| 3.4 | Initial sync: pull notes, tags, trade_tags from Supabase |

### Phase 4: Observations & Settings (Week 4)

| Task | Description |
|------|-------------|
| 4.1 | Dual repository: Observation categories |
| 4.2 | Dual repository: Observations |
| 4.3 | Dual repository: Settings |
| 4.4 | Initial sync: pull observations, categories, settings |

### Phase 5: Optional & Polish (Week 5)

| Task | Description |
|------|-------------|
| 5.1 | Dual repository: Daily summaries (or compute on-demand) |
| 5.2 | Sync status indicator (synced / pending / offline) |
| 5.3 | Conflict resolution rules (last-write-wins or timestamp) |
| 5.4 | Testing: multi-device, offline, queue retry |

---

## 6. Dependency Order

```
Trades ─────┬─────────────────────────────────────┐
            │                                     │
Accounts ───┤                                     │
            │                                     ▼
Trade notes ─┼──► Trade tags ◄── Tags             App
            │                                     │
Observations ─┼──► Obs categories                  │
            │                                     │
Settings ────┘                                     │
                                                   │
Daily summaries (optional, can derive) ───────────┘
```

---

## 7. Conflict Resolution

| Scenario | Strategy |
|----------|----------|
| Same record edited on 2 devices | Last-write-wins (updated_at) |
| Trade from cTrader vs manual edit | cTrader import always overwrites |
| Tags/notes created offline | Merge by ID; Supabase upsert on conflict |
| Orphaned trade_tags (trade deleted) | Soft delete or cascade; sync cleanup job |

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Supabase schema drift | Versioned migrations, test migration rollback |
| Large initial sync | Paginate, batch inserts, progress UI |
| Queue buildup | Process queue on app open, background worker |
| Offline edits lost | Queue writes; retry on reconnect |

---

## 9. Success Criteria

- [ ] All tables have Supabase schema + RLS
- [ ] All writes go to Dexie + Supabase (when online)
- [ ] New device: login → full data from Supabase
- [ ] App usable offline (reads from Dexie)
- [ ] Failed Supabase writes queued and retried
- [ ] No duplicate data; conflicts handled

---

## 10. Out of Scope (Future)

- Real-time sync (Supabase Realtime)
- Background sync when app closed (Service Worker)
- Selective sync (e.g. date range filters)
- Data export/import (backup to file)
