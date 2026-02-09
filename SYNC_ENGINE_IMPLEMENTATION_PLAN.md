# Supabase Sync Engine Implementation Plan

## Overview

This document outlines the stage-by-stage implementation plan for the complete Supabase sync engine with broker-based chart bar storage, progress tracking, and online/offline synchronization.

**Total Estimated Duration**: 3-4 weeks (working incrementally)

---

## Implementation Stages

### Stage 1: Database Schema Updates & Migrations
**Duration**: 1-2 days  
**Dependencies**: None  
**Status**: ⏳ Pending

#### Tasks

1. **Update Domain Entities**
   - [ ] Add `broker` field to `ChartBar` entity
   - [ ] Add `syncedAt` field to `ChartBar` entity
   - [ ] Create `SymbolSyncProgress` entity
   - [ ] Update `SyncMetaRecord` to include `userId`

2. **Create Dexie Schema V2**
   - [ ] Update `chart_bars` index: `[broker+symbol+timeframe+timestamp]`
   - [ ] Add `symbol_sync_progress` table
   - [ ] Update `sync_meta` to include `userId` as part of key
   - [ ] Create migration script to migrate existing data

3. **Migration Logic**
   - [ ] Write migration to add `broker` to existing chart_bars (derive from accounts)
   - [ ] Migrate existing chart_bars to new schema
   - [ ] Test migration with sample data

#### Deliverables
- Updated domain entities
- Dexie schema V2
- Migration script (v1 → v2)
- Tests for migration

#### Exit Criteria
- ✅ Schema migration runs successfully
- ✅ Existing data preserved
- ✅ New indexes work correctly

---

### Stage 2: Supabase Schema Setup
**Duration**: 1 day  
**Dependencies**: Stage 1  
**Status**: ⏳ Pending

#### Tasks

1. **Create Supabase Tables**
   - [ ] Create `chart_bars` table with RLS
   - [ ] Create `symbol_sync_progress` table
   - [ ] Create `sync_meta` table
   - [ ] Create indexes for performance

2. **Row Level Security (RLS)**
   - [ ] RLS policies for `chart_bars`
   - [ ] RLS policies for `symbol_sync_progress`
   - [ ] RLS policies for `sync_meta`
   - [ ] Test RLS with different users

3. **Supabase Client Setup**
   - [ ] Create Supabase client factory
   - [ ] Add environment variables
   - [ ] Create repository interfaces for Supabase

#### SQL Schema

```sql
-- Chart bars table
CREATE TABLE chart_bars (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_chart_bars_lookup 
  ON chart_bars(user_id, broker, symbol, timeframe, timestamp);

CREATE INDEX idx_chart_bars_window 
  ON chart_bars(user_id, broker, symbol, timestamp);

ALTER TABLE chart_bars ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own chart bars"
  ON chart_bars FOR ALL
  USING (auth.uid() = user_id);

-- Symbol sync progress table
CREATE TABLE symbol_sync_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_symbol_sync_progress_lookup
  ON symbol_sync_progress(user_id, broker, symbol);

ALTER TABLE symbol_sync_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own sync progress"
  ON symbol_sync_progress FOR ALL
  USING (auth.uid() = user_id);
```

#### Deliverables
- Supabase tables created
- RLS policies configured
- Supabase client factory
- Repository interfaces

#### Exit Criteria
- ✅ Tables created in Supabase
- ✅ RLS policies tested
- ✅ Can connect to Supabase from app

---

### Stage 3: Repository Layer Updates
**Duration**: 1-2 days  
**Dependencies**: Stage 1, Stage 2  
**Status**: ⏳ Pending

#### Tasks

1. **Update ChartBar Repository**
   - [ ] Update `IChartBarRepository` interface
   - [ ] Update `DexieChartBarRepository` to use broker
   - [ ] Create `SupabaseChartBarRepository` implementation
   - [ ] Add batch operations support

2. **Create SymbolSyncProgress Repository**
   - [ ] Create `ISymbolSyncProgressRepository` interface
   - [ ] Create `DexieSymbolSyncProgressRepository`
   - [ ] Create `SupabaseSymbolSyncProgressRepository`
   - [ ] Implement CRUD operations

3. **Update SyncMeta Repository**
   - [ ] Add `userId` support
   - [ ] Update queries to include userId
   - [ ] Create Supabase implementation

#### Deliverables
- Updated repository interfaces
- Dexie implementations
- Supabase implementations
- Unit tests

#### Exit Criteria
- ✅ All repositories work with new schema
- ✅ Broker-based queries work correctly
- ✅ Tests pass

---

### Stage 4: Sync Service Foundation
**Duration**: 2-3 days  
**Dependencies**: Stage 3  
**Status**: ⏳ Pending

#### Tasks

1. **Create Sync Service Interface**
   - [ ] Define `ISyncService` interface
   - [ ] Define sync result types
   - [ ] Define error types

2. **Create Base Sync Service**
   - [ ] Implement connection detection
   - [ ] Implement retry logic
   - [ ] Implement batch operations
   - [ ] Implement conflict resolution

3. **Create Sync Queue Manager**
   - [ ] Queue operations (create/update/delete)
   - [ ] Process queue with retry
   - [ ] Handle failures gracefully

#### Deliverables
- `ISyncService` interface
- `BaseSyncService` class
- `SyncQueueManager` class
- Error handling utilities

#### Exit Criteria
- ✅ Sync service can detect online/offline
- ✅ Queue operations work correctly
- ✅ Retry logic functions properly

---

### Stage 5: Trade Analysis & Bar Sync Planning
**Duration**: 1-2 days  
**Dependencies**: Stage 4  
**Status**: ⏳ Pending

#### Tasks

1. **Create Trade Analysis Use Case**
   - [ ] `AnalyzeTradesForBarSyncUseCase`
   - [ ] Extract unique brokers from trades
   - [ ] Extract unique symbols per broker
   - [ ] Calculate first trade date per broker
   - [ ] Calculate sync date range (firstTrade - 14 days)

2. **Create Sync Planning Use Case**
   - [ ] `PlanBarSyncUseCase`
   - [ ] Create `SymbolSyncProgress` records
   - [ ] Queue sync jobs
   - [ ] Return sync plan

#### Deliverables
- `AnalyzeTradesForBarSyncUseCase`
- `PlanBarSyncUseCase`
- Tests for analysis logic

#### Exit Criteria
- ✅ Can analyze trades correctly
- ✅ Generates correct sync plan
- ✅ Creates progress records

---

### Stage 6: Chart Bar Sync Implementation
**Duration**: 3-4 days  
**Dependencies**: Stage 5  
**Status**: ⏳ Pending

#### Tasks

1. **Create Bar Sync Use Case**
   - [ ] `SyncChartBarsForSymbolUseCase`
   - [ ] Fetch bars in 30-day chunks
   - [ ] Add broker field to bars
   - [ ] Batch upsert to Dexie
   - [ ] Batch upsert to Supabase (if online)
   - [ ] Update progress after each chunk

2. **Create Background Sync Worker**
   - [ ] `BarSyncWorker` class
   - [ ] Process sync queue
   - [ ] Handle multiple symbols concurrently
   - [ ] Rate limiting
   - [ ] Error handling

3. **Integrate with Existing Chart Loading**
   - [ ] Update `LoadChartWindowUseCase` to use broker
   - [ ] Update `useChartData` hook
   - [ ] Ensure backward compatibility

#### Deliverables
- `SyncChartBarsForSymbolUseCase`
- `BarSyncWorker` class
- Updated chart loading logic
- Progress tracking

#### Exit Criteria
- ✅ Can sync bars for a symbol
- ✅ Progress updates correctly
- ✅ Works offline and online
- ✅ Charts still load correctly

---

### Stage 7: Progress Tracking System
**Duration**: 2 days  
**Dependencies**: Stage 6  
**Status**: ⏳ Pending

#### Tasks

1. **Create Progress Store**
   - [ ] Zustand store for sync progress
   - [ ] Real-time progress updates
   - [ ] Overall progress calculation
   - [ ] Per-broker progress

2. **Create Progress Event System**
   - [ ] Event emitter for progress
   - [ ] Subscribe/unsubscribe logic
   - [ ] Persist progress to Dexie
   - [ ] Sync progress to Supabase

3. **Create Progress Hooks**
   - [ ] `useSyncProgress` hook
   - [ ] `useSymbolProgress` hook
   - [ ] `useOverallProgress` hook

#### Deliverables
- Progress store (Zustand)
- Progress event system
- React hooks for progress
- Progress persistence

#### Exit Criteria
- ✅ Progress updates in real-time
- ✅ Progress persists across refreshes
- ✅ Can query progress by broker/symbol

---

### Stage 8: Settings Page - Sync Management UI
**Duration**: 2-3 days  
**Dependencies**: Stage 7  
**Status**: ⏳ Pending

#### Tasks

1. **Create Settings Page Structure**
   - [ ] Settings page layout
   - [ ] Tabs/sections for different settings
   - [ ] "Chart Data Sync" section

2. **Create Sync Status Components**
   - [ ] Overall sync status card
   - [ ] Per-broker breakdown
   - [ ] Per-symbol status list
   - [ ] Progress bars
   - [ ] Action buttons (sync, retry, cancel)

3. **Create Sync Actions**
   - [ ] Manual sync trigger
   - [ ] Retry failed syncs
   - [ ] Cancel ongoing syncs
   - [ ] View sync details

#### Deliverables
- Settings page with sync section
- Sync status components
- Action handlers
- UI tests

#### Exit Criteria
- ✅ Can view sync progress
- ✅ Can trigger manual sync
- ✅ Can retry failed syncs
- ✅ Progress persists after refresh

---

### Stage 9: Real-time Sync Integration
**Duration**: 2 days  
**Dependencies**: Stage 8  
**Status**: ⏳ Pending

#### Tasks

1. **Create Realtime Subscription Manager**
   - [ ] Subscribe to chart_bars changes
   - [ ] Subscribe to symbol_sync_progress changes
   - [ ] Handle connection/disconnection
   - [ ] Reconnect logic

2. **Integrate with Sync Service**
   - [ ] Update Dexie on realtime events
   - [ ] Update UI reactively
   - [ ] Handle conflicts

3. **Create Realtime Hooks**
   - [ ] `useRealtimeSync` hook
   - [ ] Auto-start on login
   - [ ] Cleanup on logout

#### Deliverables
- Realtime subscription manager
- Integration with sync service
- React hooks for realtime
- Connection handling

#### Exit Criteria
- ✅ Real-time updates work
- ✅ Handles disconnections
- ✅ Updates UI automatically

---

### Stage 10: Post-Login Sync Flow
**Duration**: 2 days  
**Dependencies**: Stage 9  
**Status**: ⏳ Pending

#### Tasks

1. **Create Sync Initialization Use Case**
   - [ ] `InitializeSyncUseCase`
   - [ ] Check if first-time sync
   - [ ] Determine sync strategy
   - [ ] Trigger appropriate sync

2. **Integrate with Auth Flow**
   - [ ] Hook into `AuthProvider`
   - [ ] Trigger sync on login
   - [ ] Show sync progress in UI
   - [ ] Handle sync completion

3. **Create Sync Orchestrator**
   - [ ] Coordinate all sync operations
   - [ ] Priority ordering
   - [ ] Error handling
   - [ ] Progress aggregation

#### Deliverables
- `InitializeSyncUseCase`
- Auth integration
- Sync orchestrator
- UI progress indicators

#### Exit Criteria
- ✅ Sync starts automatically on login
- ✅ Progress visible to user
- ✅ All data types sync correctly

---

### Stage 11: Higher Timeframe Handling
**Duration**: 1-2 days  
**Dependencies**: Stage 6  
**Status**: ⏳ Pending

#### Tasks

1. **Create Timeframe Aggregation**
   - [ ] `aggregateBars` utility function
   - [ ] M1 → M5 aggregation
   - [ ] M1 → M15 aggregation
   - [ ] M1 → H1 aggregation
   - [ ] M1 → D1 aggregation

2. **Update Chart Loading Logic**
   - [ ] Check if online for non-M1
   - [ ] Aggregate from M1 if offline
   - [ ] Fetch from API if online
   - [ ] Cache aggregated bars

3. **Create Timeframe Utilities**
   - [ ] Timeframe conversion helpers
   - [ ] Bar grouping logic
   - [ ] OHLC calculation

#### Deliverables
- Aggregation utilities
- Updated chart loading
- Timeframe helpers
- Tests for aggregation

#### Exit Criteria
- ✅ Can view higher timeframes offline (from M1)
- ✅ Fetches higher timeframes online
- ✅ Aggregation works correctly

---

### Stage 12: Testing & Integration
**Duration**: 2-3 days  
**Dependencies**: All stages  
**Status**: ⏳ Pending

#### Tasks

1. **Unit Tests**
   - [ ] Test all use cases
   - [ ] Test repositories
   - [ ] Test sync logic
   - [ ] Test aggregation

2. **Integration Tests**
   - [ ] Test full sync flow
   - [ ] Test offline/online transitions
   - [ ] Test conflict resolution
   - [ ] Test progress tracking

3. **E2E Tests**
   - [ ] Test login → sync flow
   - [ ] Test settings page
   - [ ] Test chart loading
   - [ ] Test manual sync

4. **Performance Testing**
   - [ ] Large dataset sync
   - [ ] Concurrent syncs
   - [ ] Memory usage
   - [ ] Database performance

#### Deliverables
- Unit test suite
- Integration tests
- E2E tests
- Performance benchmarks

#### Exit Criteria
- ✅ All tests pass
- ✅ Performance acceptable
- ✅ No memory leaks

---

### Stage 13: Documentation & Polish
**Duration**: 1-2 days  
**Dependencies**: Stage 12  
**Status**: ⏳ Pending

#### Tasks

1. **Code Documentation**
   - [ ] JSDoc comments
   - [ ] README updates
   - [ ] Architecture diagrams
   - [ ] API documentation

2. **User Documentation**
   - [ ] Settings page guide
   - [ ] Sync status explanation
   - [ ] Troubleshooting guide

3. **Final Polish**
   - [ ] Error messages
   - [ ] Loading states
   - [ ] UI improvements
   - [ ] Accessibility

#### Deliverables
- Complete documentation
- Polished UI
- User guides

#### Exit Criteria
- ✅ Documentation complete
- ✅ UI polished
- ✅ Ready for production

---

## Implementation Order

```
Stage 1 (Schema) 
    ↓
Stage 2 (Supabase Setup)
    ↓
Stage 3 (Repositories)
    ↓
Stage 4 (Sync Foundation)
    ↓
Stage 5 (Trade Analysis)
    ↓
Stage 6 (Bar Sync) ──┐
    ↓                 │
Stage 7 (Progress)    │
    ↓                 │
Stage 8 (Settings UI)  │
    ↓                 │
Stage 9 (Realtime)     │
    ↓                 │
Stage 10 (Post-Login) │
    ↓                 │
Stage 11 (Timeframes) ←┘
    ↓
Stage 12 (Testing)
    ↓
Stage 13 (Documentation)
```

---

## Key Design Decisions

### 1. Broker-Based Storage
- **Why**: Multiple accounts (live/demo) with same broker share bars
- **How**: Store `broker` field, not `accountId` in chart_bars
- **Impact**: Reduces storage, improves sync efficiency

### 2. M1-First Strategy
- **Why**: M1 bars can aggregate to any timeframe
- **How**: Only sync M1 initially, fetch higher timeframes on-demand
- **Impact**: Faster initial sync, less storage

### 3. Progress Persistence
- **Why**: User needs to see progress after refresh
- **How**: Store in Dexie `symbol_sync_progress` table
- **Impact**: Better UX, resumable syncs

### 4. Chunked Sync
- **Why**: Large date ranges can timeout
- **How**: Process in 30-day chunks
- **Impact**: More reliable, better progress tracking

### 5. Dual Storage
- **Why**: Offline-first with cloud backup
- **How**: Dexie (primary) + Supabase (backup)
- **Impact**: Works offline, syncs when online

---

## Testing Strategy

### Unit Tests
- Each use case independently
- Repository methods
- Utility functions
- Aggregation logic

### Integration Tests
- Sync flow end-to-end
- Offline/online transitions
- Conflict resolution
- Progress tracking

### E2E Tests
- Login → sync flow
- Settings page interactions
- Chart loading scenarios
- Manual sync triggers

### Performance Tests
- Large dataset sync (100k+ bars)
- Concurrent symbol syncs
- Memory profiling
- Database query performance

---

## Risk Mitigation

### Risk 1: Large Sync Times
- **Mitigation**: Chunked sync, progress tracking, background processing
- **Fallback**: Allow cancellation, resume from last position

### Risk 2: Storage Limits
- **Mitigation**: M1-only strategy, compression for old bars
- **Fallback**: Retention policies, user can delete old data

### Risk 3: API Rate Limits
- **Mitigation**: Rate limiting, exponential backoff
- **Fallback**: Queue operations, retry later

### Risk 4: Data Conflicts
- **Mitigation**: Version numbers, last-write-wins
- **Fallback**: User intervention for critical conflicts

### Risk 5: Migration Issues
- **Mitigation**: Thorough testing, backup before migration
- **Fallback**: Rollback script, data recovery

---

## Success Metrics

### Performance
- ✅ Initial sync completes in < 10 minutes for typical user
- ✅ Chart loads in < 1 second from cache
- ✅ Progress updates every 5 seconds during sync
- ✅ Memory usage < 500MB for 1M bars

### Reliability
- ✅ Sync resumes after page refresh
- ✅ Handles network failures gracefully
- ✅ No data loss during sync
- ✅ Conflicts resolved correctly

### User Experience
- ✅ Progress visible at all times
- ✅ Can cancel ongoing syncs
- ✅ Can retry failed syncs
- ✅ Settings page shows clear status

---

## Next Steps

1. **Review this plan** with team/stakeholders
2. **Set up Supabase project** if not already done
3. **Start with Stage 1** (Schema updates)
4. **Test each stage** before moving to next
5. **Iterate** based on feedback

---

## Notes

- Each stage should be tested independently
- Don't move to next stage until current stage is complete
- Keep backward compatibility where possible
- Document decisions and changes
- Regular commits with clear messages

---

**Last Updated**: 2025-02-09  
**Status**: Planning Phase  
**Next Review**: After Stage 1 completion
