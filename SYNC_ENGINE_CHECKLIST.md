# Sync Engine Implementation Checklist

Quick reference checklist for tracking progress through each stage.

## Stage 1: Database Schema Updates & Migrations
- [ ] Add `broker` field to `ChartBar` entity
- [ ] Add `syncedAt` field to `ChartBar` entity
- [ ] Create `SymbolSyncProgress` entity
- [ ] Update `SyncMetaRecord` to include `userId`
- [ ] Create Dexie Schema V2
- [ ] Update `chart_bars` index
- [ ] Add `symbol_sync_progress` table
- [ ] Update `sync_meta` table
- [ ] Write migration script (v1 → v2)
- [ ] Test migration with sample data
- [ ] Verify existing data preserved

## Stage 2: Supabase Schema Setup
- [ ] Create `chart_bars` table in Supabase
- [ ] Create `symbol_sync_progress` table in Supabase
- [ ] Create `sync_meta` table in Supabase
- [ ] Add indexes for performance
- [ ] Configure RLS policies for `chart_bars`
- [ ] Configure RLS policies for `symbol_sync_progress`
- [ ] Configure RLS policies for `sync_meta`
- [ ] Test RLS with different users
- [ ] Create Supabase client factory
- [ ] Add environment variables
- [ ] Create repository interfaces for Supabase

## Stage 3: Repository Layer Updates
- [ ] Update `IChartBarRepository` interface
- [ ] Update `DexieChartBarRepository` to use broker
- [ ] Create `SupabaseChartBarRepository` implementation
- [ ] Add batch operations support
- [ ] Create `ISymbolSyncProgressRepository` interface
- [ ] Create `DexieSymbolSyncProgressRepository`
- [ ] Create `SupabaseSymbolSyncProgressRepository`
- [ ] Update SyncMeta repository with userId
- [ ] Write unit tests for repositories
- [ ] Verify broker-based queries work

## Stage 4: Sync Service Foundation
- [ ] Define `ISyncService` interface
- [ ] Define sync result types
- [ ] Define error types
- [ ] Implement connection detection
- [ ] Implement retry logic
- [ ] Implement batch operations
- [ ] Implement conflict resolution
- [ ] Create `SyncQueueManager` class
- [ ] Implement queue operations
- [ ] Implement queue processing with retry
- [ ] Test error handling

## Stage 5: Trade Analysis & Bar Sync Planning
- [ ] Create `AnalyzeTradesForBarSyncUseCase`
- [ ] Extract unique brokers from trades
- [ ] Extract unique symbols per broker
- [ ] Calculate first trade date per broker
- [ ] Calculate sync date range
- [ ] Create `PlanBarSyncUseCase`
- [ ] Create `SymbolSyncProgress` records
- [ ] Queue sync jobs
- [ ] Test analysis logic

## Stage 6: Chart Bar Sync Implementation
- [ ] Create `SyncChartBarsForSymbolUseCase`
- [ ] Implement 30-day chunk processing
- [ ] Add broker field to bars
- [ ] Batch upsert to Dexie
- [ ] Batch upsert to Supabase (if online)
- [ ] Update progress after each chunk
- [ ] Create `BarSyncWorker` class
- [ ] Process sync queue
- [ ] Handle multiple symbols concurrently
- [ ] Implement rate limiting
- [ ] Update `LoadChartWindowUseCase` to use broker
- [ ] Update `useChartData` hook
- [ ] Ensure backward compatibility

## Stage 7: Progress Tracking System
- [ ] Create Zustand progress store
- [ ] Real-time progress updates
- [ ] Overall progress calculation
- [ ] Per-broker progress
- [ ] Create progress event emitter
- [ ] Subscribe/unsubscribe logic
- [ ] Persist progress to Dexie
- [ ] Sync progress to Supabase
- [ ] Create `useSyncProgress` hook
- [ ] Create `useSymbolProgress` hook
- [ ] Create `useOverallProgress` hook
- [ ] Test progress persistence

## Stage 8: Settings Page - Sync Management UI
- [ ] Create settings page layout
- [ ] Add "Chart Data Sync" section
- [ ] Create overall sync status card
- [ ] Create per-broker breakdown
- [ ] Create per-symbol status list
- [ ] Add progress bars
- [ ] Add action buttons (sync, retry, cancel)
- [ ] Implement manual sync trigger
- [ ] Implement retry failed syncs
- [ ] Implement cancel ongoing syncs
- [ ] Add view sync details
- [ ] Test UI interactions

## Stage 9: Real-time Sync Integration
- [ ] Create realtime subscription manager
- [ ] Subscribe to chart_bars changes
- [ ] Subscribe to symbol_sync_progress changes
- [ ] Handle connection/disconnection
- [ ] Implement reconnect logic
- [ ] Update Dexie on realtime events
- [ ] Update UI reactively
- [ ] Handle conflicts
- [ ] Create `useRealtimeSync` hook
- [ ] Auto-start on login
- [ ] Cleanup on logout

## Stage 10: Post-Login Sync Flow
- [ ] Create `InitializeSyncUseCase`
- [ ] Check if first-time sync
- [ ] Determine sync strategy
- [ ] Trigger appropriate sync
- [ ] Hook into `AuthProvider`
- [ ] Trigger sync on login
- [ ] Show sync progress in UI
- [ ] Handle sync completion
- [ ] Create sync orchestrator
- [ ] Coordinate all sync operations
- [ ] Implement priority ordering
- [ ] Test full login flow

## Stage 11: Higher Timeframe Handling
- [ ] Create `aggregateBars` utility function
- [ ] Implement M1 → M5 aggregation
- [ ] Implement M1 → M15 aggregation
- [ ] Implement M1 → H1 aggregation
- [ ] Implement M1 → D1 aggregation
- [ ] Update chart loading logic
- [ ] Check online status for non-M1
- [ ] Aggregate from M1 if offline
- [ ] Fetch from API if online
- [ ] Cache aggregated bars
- [ ] Create timeframe utilities
- [ ] Test aggregation logic

## Stage 12: Testing & Integration
- [ ] Write unit tests for use cases
- [ ] Write unit tests for repositories
- [ ] Write unit tests for sync logic
- [ ] Write unit tests for aggregation
- [ ] Write integration tests for sync flow
- [ ] Write integration tests for offline/online transitions
- [ ] Write integration tests for conflict resolution
- [ ] Write integration tests for progress tracking
- [ ] Write E2E test for login → sync flow
- [ ] Write E2E test for settings page
- [ ] Write E2E test for chart loading
- [ ] Write E2E test for manual sync
- [ ] Performance test with large dataset
- [ ] Performance test with concurrent syncs
- [ ] Memory profiling
- [ ] Database query performance testing

## Stage 13: Documentation & Polish
- [ ] Add JSDoc comments
- [ ] Update README
- [ ] Create architecture diagrams
- [ ] Write API documentation
- [ ] Create settings page guide
- [ ] Write sync status explanation
- [ ] Create troubleshooting guide
- [ ] Improve error messages
- [ ] Improve loading states
- [ ] UI improvements
- [ ] Accessibility improvements

---

## Current Status

**Current Stage**: Planning Complete  
**Next Stage**: Stage 1 - Database Schema Updates  
**Blockers**: None  
**Notes**: Ready to begin implementation

---

## Quick Commands Reference

```bash
# Run tests
npm test

# Run type checking
npm run type-check

# Run linting
npm run lint

# Build project
npm run build

# Start dev server
npm run dev
```

---

**Last Updated**: 2025-02-09
