# Sync Engine Architecture Overview

## Core Concepts

### 1. Broker-Based Storage

**Problem**: Multiple accounts (live/demo) from the same broker share identical chart data.

**Solution**: Store chart bars with `broker` identifier instead of `accountId`.

**Benefits**:
- Reduces storage by ~50% (no duplicate bars)
- Faster sync (sync once per broker, not per account)
- Simpler queries

**Example**:
```typescript
// Before: Bars stored per account
chart_bars: { accountId: "123", symbol: "EURUSD", ... }
chart_bars: { accountId: "456", symbol: "EURUSD", ... } // Duplicate!

// After: Bars stored per broker
chart_bars: { broker: "IC Markets", symbol: "EURUSD", ... } // Shared!
```

---

### 2. M1-First Strategy

**Problem**: Syncing all timeframes for all symbols is slow and storage-intensive.

**Solution**: Only sync M1 bars initially. Higher timeframes fetched on-demand.

**Benefits**:
- Faster initial sync
- Less storage (M1 can aggregate to any timeframe)
- Better offline experience (can view any timeframe from M1)

**How It Works**:
```
Initial Sync:
  └─ Sync M1 bars only (for all symbols)

When Viewing Chart:
  ├─ M1 timeframe → Use cached M1 bars
  ├─ Higher timeframe + Online → Fetch from API
  └─ Higher timeframe + Offline → Aggregate from M1
```

**Aggregation Example**:
```typescript
// M1 bars: 1-minute intervals
M1: [09:00, 09:01, 09:02, 09:03, 09:04, ...]

// Aggregate to M5: 5-minute intervals
M5: [
  { time: 09:00, open: 1.1000, high: 1.1005, low: 1.0998, close: 1.1002 },
  { time: 09:05, open: 1.1002, high: 1.1008, low: 1.1000, close: 1.1006 },
  ...
]
```

---

### 3. Dual Storage Architecture

**Problem**: Need offline-first with cloud backup.

**Solution**: Dexie (IndexedDB) as primary, Supabase as backup.

**Flow**:
```
┌─────────────┐
│   UI Layer  │
└──────┬──────┘
       │
       ↓
┌─────────────┐      ┌─────────────┐
│    Dexie    │◄────►│  Supabase   │
│  (Primary)  │ Sync │  (Backup)   │
└─────────────┘      └─────────────┘
```

**Benefits**:
- Fast local access (Dexie)
- Cloud backup (Supabase)
- Works offline
- Syncs when online

---

### 4. Progress Tracking System

**Problem**: User needs to see sync progress, even after page refresh.

**Solution**: Persistent progress tracking in Dexie + Supabase.

**Structure**:
```typescript
interface SymbolSyncProgress {
  broker: string;
  symbol: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  progressPercent: number;      // 0-100
  totalBars: number;
  firstBarDate: Date | null;
  lastBarDate: Date | null;
  lastSyncTime: Date | null;
  error?: string;
}
```

**Where Shown**:
- Settings page (persistent, survives refresh)
- Header indicator (when actively syncing)
- Toast notifications (on completion/failure)

---

### 5. Chunked Sync Strategy

**Problem**: Large date ranges can timeout or cause memory issues.

**Solution**: Process sync in 30-day chunks.

**Flow**:
```
Sync EURUSD from 2020-01-01 to 2025-02-09:

Chunk 1: 2020-01-01 to 2020-01-31 → Update progress: 10%
Chunk 2: 2020-02-01 to 2020-02-29 → Update progress: 20%
Chunk 3: 2020-03-01 to 2020-03-31 → Update progress: 30%
...
Chunk 61: 2025-01-01 to 2025-01-31 → Update progress: 98%
Chunk 62: 2025-02-01 to 2025-02-09 → Update progress: 100% ✅
```

**Benefits**:
- More reliable (no timeouts)
- Better progress tracking
- Can resume from last chunk on failure
- Lower memory usage

---

## Data Flow Diagrams

### Post-Login Sync Flow

```
User Logs In
    ↓
AuthProvider detects session
    ↓
InitializeSyncUseCase.execute()
    ↓
┌─────────────────────────────────┐
│ 1. Sync Accounts                 │
│    Supabase → Dexie              │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 2. Sync Trades                   │
│    Supabase → Dexie              │
│    (incremental if returning)    │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 3. Analyze Trades                │
│    - Extract brokers             │
│    - Extract symbols             │
│    - Find first trade date       │
│    - Calculate sync range        │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 4. Plan Bar Sync                 │
│    - Create SymbolSyncProgress   │
│    - Queue sync jobs             │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 5. Background Sync (Worker)      │
│    For each symbol:              │
│    - Fetch M1 bars (30-day chunks)│
│    - Store in Dexie              │
│    - Sync to Supabase            │
│    - Update progress             │
└─────────────────────────────────┘
    ↓
┌─────────────────────────────────┐
│ 6. Start Realtime Sync           │
│    - Subscribe to changes        │
│    - Update Dexie on events      │
└─────────────────────────────────┘
```

### Chart Loading Flow

```
User Views Trade Chart
    ↓
Get account for trade
    ↓
Extract broker from account
    ↓
┌─────────────────────────────────┐
│ Check Timeframe                 │
└─────────────────────────────────┘
    ├─ M1 → Use cached M1 bars
    │
    └─ Higher Timeframe
         ├─ Online → Fetch from API
         └─ Offline → Aggregate from M1
```

---

## Database Schema

### Dexie (Local)

```typescript
// Chart bars (broker-based)
chart_bars: {
  id: number;
  broker: string;           // NEW
  symbol: string;
  timeframe: "M1";          // Only M1 initially
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  syncedAt?: Date;          // NEW
}

// Symbol sync progress (NEW)
symbol_sync_progress: {
  id: number;
  broker: string;
  symbol: string;
  status: 'pending' | 'syncing' | 'completed' | 'failed';
  progressPercent: number;
  totalBars: number;
  firstBarDate: Date | null;
  lastBarDate: Date | null;
  lastSyncTime: Date | null;
  error?: string;
}

// Indexes
chart_bars: "[broker+symbol+timeframe+timestamp]"
symbol_sync_progress: "[broker+symbol]"
```

### Supabase (Cloud)

```sql
-- Chart bars table
CREATE TABLE chart_bars (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  timestamp BIGINT NOT NULL,
  open DECIMAL NOT NULL,
  high DECIMAL NOT NULL,
  low DECIMAL NOT NULL,
  close DECIMAL NOT NULL,
  volume BIGINT NOT NULL,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  UNIQUE(user_id, broker, symbol, timeframe, timestamp)
);

-- Symbol sync progress
CREATE TABLE symbol_sync_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  first_bar_date TIMESTAMPTZ,
  last_bar_date TIMESTAMPTZ,
  last_sync_time TIMESTAMPTZ,
  total_bars INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  progress_percent INTEGER DEFAULT 0,
  UNIQUE(user_id, broker, symbol)
);
```

---

## Key Components

### 1. Sync Service (`ISyncService`)

**Responsibilities**:
- Detect online/offline status
- Coordinate sync operations
- Handle conflicts
- Manage retry logic

**Interface**:
```typescript
interface ISyncService {
  initializeSync(userId: string): Promise<SyncResult>;
  syncIncremental(accountId: string, lastSyncTime: Date): Promise<SyncResult>;
  syncFull(accountId: string): Promise<SyncResult>;
  startRealtimeSync(userId: string): void;
  stopRealtimeSync(): void;
  processSyncQueue(): Promise<void>;
}
```

### 2. Bar Sync Worker (`BarSyncWorker`)

**Responsibilities**:
- Process sync queue
- Fetch bars in chunks
- Update progress
- Handle errors

**Flow**:
```
Worker starts
    ↓
Get next symbol from queue
    ↓
Calculate date range
    ↓
Split into 30-day chunks
    ↓
For each chunk:
  ├─ Fetch from API
  ├─ Store in Dexie
  ├─ Sync to Supabase
  └─ Update progress
    ↓
Mark symbol complete
    ↓
Get next symbol
```

### 3. Progress Store (Zustand)

**State**:
```typescript
interface SyncProgressState {
  symbolProgress: Map<string, SymbolSyncProgress>;
  overallProgress: {
    totalSymbols: number;
    completedSymbols: number;
    syncingSymbols: number;
    failedSymbols: number;
    totalBarsSynced: number;
  };
}
```

**Actions**:
- Update symbol progress
- Get progress by broker
- Get overall progress
- Reset progress

---

## Conflict Resolution

### Strategy: Last-Write-Wins with Versioning

**How It Works**:
1. Each record has `version` number
2. Each record has `updatedAt` timestamp
3. On conflict, compare versions
4. If versions equal, compare timestamps
5. Newer version/timestamp wins

**Example**:
```typescript
// Local: version 5, updatedAt: 2025-02-09 10:00
// Remote: version 6, updatedAt: 2025-02-09 11:00

// Remote wins (higher version)
```

**For Chart Bars**:
- Chart bars are immutable (timestamp is unique key)
- No conflicts possible (same timestamp = same bar)
- Only need to handle sync queue conflicts

---

## Error Handling

### Sync Errors

**Types**:
1. Network errors → Queue for retry
2. Rate limit errors → Exponential backoff
3. Conflict errors → Resolve automatically
4. Data errors → Log and skip

**Retry Strategy**:
```
Attempt 1: Immediate
Attempt 2: Wait 1 second
Attempt 3: Wait 2 seconds
Attempt 4: Wait 4 seconds
Attempt 5: Wait 8 seconds
After 5 attempts: Mark as failed, user can retry manually
```

### User Notifications

- **Success**: Toast notification "Sync completed"
- **Progress**: Progress bar in settings
- **Error**: Error message in settings, retry button
- **Warning**: "Some symbols failed to sync"

---

## Performance Considerations

### Storage Optimization

1. **M1-only**: ~80% storage reduction
2. **Broker-based**: ~50% storage reduction (no duplicates)
3. **Compression**: For bars older than 90 days (future)

### Sync Optimization

1. **Chunked sync**: Prevents timeouts
2. **Batch operations**: 1000 bars per batch
3. **Concurrent syncs**: Up to 3 symbols at once
4. **Rate limiting**: Respect API limits

### Query Optimization

1. **Indexes**: `[broker+symbol+timeframe+timestamp]`
2. **Date range queries**: Use between() efficiently
3. **Lazy loading**: Only load visible range
4. **Caching**: Cache aggregated timeframes

---

## Security

### Row Level Security (RLS)

**Policy**: Users can only access their own data

```sql
CREATE POLICY "Users can only access their own chart bars"
  ON chart_bars FOR ALL
  USING (auth.uid() = user_id);
```

### Data Validation

- Validate broker name
- Validate symbol format
- Validate timestamp ranges
- Sanitize user inputs

---

## Testing Strategy

### Unit Tests
- Use cases independently
- Repository methods
- Utility functions
- Aggregation logic

### Integration Tests
- Full sync flow
- Offline/online transitions
- Conflict resolution
- Progress tracking

### E2E Tests
- Login → sync flow
- Settings page interactions
- Chart loading
- Manual sync

### Performance Tests
- Large dataset (100k+ bars)
- Concurrent syncs
- Memory profiling
- Query performance

---

## Future Enhancements

1. **Compression**: Compress old bars (>90 days)
2. **Retention Policies**: Auto-delete old bars
3. **Incremental Sync**: Only sync new bars after initial sync
4. **Multi-timeframe Sync**: Option to sync higher timeframes
5. **Export/Import**: Export sync progress, import to new device

---

**Last Updated**: 2025-02-09
