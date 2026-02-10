# Architecture - Clean Architecture and SOLID

This document defines the architectural principles, layering, and detailed file structure
for the pipCircuit application. The architecture ensures business logic remains
independent from frameworks, databases, and UI concerns.

---

## 🎯 Architectural Goals

1. **Testability**: Domain and application logic testable without frameworks.
2. **Maintainability**: Clear boundaries reduce coupling and improve readability.
3. **Scalability**: Easy to add features without restructuring.
4. **Flexibility**: Swap infrastructure (DB, API) without changing business logic.
5. **Offline-First**: Local data layer as primary, cloud as sync.

---

## 📐 SOLID Principles Applied

### Single Responsibility (SRP)

- Each module/class has one reason to change.
- Use cases handle one operation.
- Components render one concern.

### Open/Closed (OCP)

- Extend behavior via new implementations.
- Use interfaces for variation points.
- Plugins for optional features.

### Liskov Substitution (LSP)

- All repository implementations honor their interfaces.
- Any implementation can replace another.

### Interface Segregation (ISP)

- Small, focused interfaces.
- Clients depend only on methods they use.

### Dependency Inversion (DIP)

- High-level modules don't depend on low-level modules.
- Both depend on abstractions (interfaces).
- Domain and Application layers have zero infrastructure imports.

---

## 🏗️ Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                         UI Layer                        │
│   Next.js Pages, React Components, Hooks, Zustand      │
└─────────────────────────────────────────────────────────┘
                              │
                              │ calls
                              ▼
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                     │
│        Use Cases, DTOs, Mappers, Port Interfaces       │
└─────────────────────────────────────────────────────────┘
                              │
                              │ uses
                              ▼
┌─────────────────────────────────────────────────────────┐
│                     Domain Layer                        │
│     Entities, Value Objects, Enums, Domain Services    │
└─────────────────────────────────────────────────────────┘
                              ▲
                              │ implements
                              │
┌─────────────────────────────────────────────────────────┐
│                 Infrastructure Layer                    │
│    Dexie Repos, Supabase Clients, cTrader API, Cache   │
└─────────────────────────────────────────────────────────┘
```

### Dependency Flow

```
UI ──► Application ──► Domain
           ▲
           │
Infrastructure (implements ports)
```

**Critical Rule**: Dependencies ONLY point inward. Infrastructure plugs into application
layer via interface implementations.

---

## 📁 Project File Structure

```
personal-journal/
│
├── 📁 app/                                    # Next.js App Router (UI Entry Points)
│   ├── 📁 (auth)/                            # Auth route group
│   │   ├── login/
│   │   │   └── page.tsx                      # Login page
│   │   ├── callback/
│   │   │   └── page.tsx                      # OAuth callback handler
│   │   └── layout.tsx                        # Auth layout (minimal)
│   │
│   ├── 📁 (app)/                             # Main app route group (authenticated)
│   │   ├── dashboard/
│   │   │   └── page.tsx                      # Dashboard page
│   │   ├── journal/
│   │   │   ├── page.tsx                      # Trade history (default)
│   │   │   ├── daily/
│   │   │   │   └── page.tsx                  # Daily journal calendar
│   │   │   └── library/
│   │   │       └── page.tsx                  # Library section
│   │   ├── trade/
│   │   │   └── [id]/
│   │   │       └── page.tsx                  # Trade detail page
│   │   ├── accounts/
│   │   │   └── page.tsx                      # Accounts management
│   │   ├── settings/
│   │   │   └── page.tsx                      # App settings
│   │   └── layout.tsx                        # App layout with sidebar
│   │
│   ├── api/                                   # API routes (if needed)
│   │   └── auth/
│   │       └── callback/
│   │           └── route.ts                  # OAuth callback API
│   │
│   ├── layout.tsx                            # Root layout
│   ├── page.tsx                              # Landing/redirect
│   ├── loading.tsx                           # Global loading
│   ├── error.tsx                             # Global error boundary
│   ├── not-found.tsx                         # 404 page
│   └── globals.css                           # Global styles
│
├── 📁 src/                                   # Source code (Clean Architecture)
│   │
│   ├── 📁 domain/                            # Domain Layer (Pure Business Logic)
│   │   │
│   │   ├── 📁 entities/                      # Core business entities
│   │   │   ├── Trade.ts                      # Trade entity
│   │   │   ├── TradeNote.ts                  # Journal note entity
│   │   │   ├── Observation.ts                # Market observation entity
│   │   │   ├── ObservationCategory.ts        # Category entity
│   │   │   ├── Tag.ts                        # Tag entity
│   │   │   ├── ChartBar.ts                   # OHLCV bar entity
│   │   │   ├── Account.ts                    # Trading account entity
│   │   │   ├── SyncJob.ts                    # Sync queue item entity
│   │   │   ├── DailySummary.ts               # Daily aggregation entity
│   │   │   └── index.ts                      # Barrel export
│   │   │
│   │   ├── 📁 value-objects/                 # Immutable value types
│   │   │   ├── Money.ts                      # Currency + amount
│   │   │   ├── TimeRange.ts                  # Start/end timestamps
│   │   │   ├── DateRange.ts                  # Date range with presets
│   │   │   ├── Symbol.ts                     # Trading pair identifier
│   │   │   ├── PriceLevel.ts                 # Price + type (TP/SL)
│   │   │   ├── TradeResult.ts                # P&L calculation
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 enums/                         # Domain enumerations
│   │   │   ├── Direction.ts                  # Buy, Sell
│   │   │   ├── OrderType.ts                  # Market, Limit, Stop
│   │   │   ├── TradeOutcome.ts               # TakeProfit, StopLoss, etc.
│   │   │   ├── Session.ts                    # NewYork, London, Asia, Out
│   │   │   ├── Mindset.ts                    # Happy, Sad, Anxious, etc.
│   │   │   ├── PlacedBy.ts                   # Algo, Dealer, Manual, Mobile
│   │   │   ├── TagCategory.ts                # Strategy, Mistakes, Custom
│   │   │   ├── SyncAction.ts                 # Create, Update, Delete
│   │   │   ├── SyncStatus.ts                 # Pending, Syncing, Synced, Error
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 services/                      # Domain services (pure logic)
│   │   │   ├── TradeCalculator.ts            # P&L, R:R, duration calculations
│   │   │   ├── SessionClassifier.ts         # Determine market session
│   │   │   ├── StatisticsCalculator.ts      # Win rate, Sharpe, etc.
│   │   │   ├── TimeframeAggregator.ts       # Aggregate bars to higher TF
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 errors/                        # Domain-specific errors
│   │   │   ├── DomainError.ts               # Base domain error
│   │   │   ├── ValidationError.ts           # Validation failures
│   │   │   ├── TradeNotFoundError.ts        # Trade lookup failures
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts                          # Domain barrel export
│   │
│   ├── 📁 application/                       # Application Layer (Use Cases)
│   │   │
│   │   ├── 📁 use-cases/                     # Application use cases
│   │   │   │
│   │   │   ├── 📁 trades/                    # Trade-related use cases
│   │   │   │   ├── GetTradesUseCase.ts       # List trades with filters
│   │   │   │   ├── GetTradeByIdUseCase.ts    # Single trade lookup
│   │   │   │   ├── ImportTradesUseCase.ts    # Import from cTrader
│   │   │   │   ├── UpdateTradeUseCase.ts     # Update trade metadata
│   │   │   │   ├── ExportTradesUseCase.ts    # Export trades to CSV
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 journal/                   # Journal-related use cases
│   │   │   │   ├── GetTradeNoteUseCase.ts
│   │   │   │   ├── SaveTradeNoteUseCase.ts
│   │   │   │   ├── GetDailyJournalUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 observations/              # Observation use cases
│   │   │   │   ├── GetObservationsUseCase.ts
│   │   │   │   ├── CreateObservationUseCase.ts
│   │   │   │   ├── UpdateObservationUseCase.ts
│   │   │   │   ├── DeleteObservationUseCase.ts
│   │   │   │   ├── ManageCategoriesUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 tags/                      # Tag-related use cases
│   │   │   │   ├── GetTagsUseCase.ts
│   │   │   │   ├── CreateTagUseCase.ts
│   │   │   │   ├── UpdateTagUseCase.ts
│   │   │   │   ├── DeleteTagUseCase.ts
│   │   │   │   ├── AssignTagToTradeUseCase.ts
│   │   │   │   ├── RemoveTagFromTradeUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 charts/                    # Chart-related use cases
│   │   │   │   ├── LoadChartWindowUseCase.ts # Load bars for trade
│   │   │   │   ├── LoadChartChunkUseCase.ts  # Load additional chunk
│   │   │   │   ├── ImportChartDataUseCase.ts # Fetch from cTrader
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 analytics/                 # Analytics use cases
│   │   │   │   ├── CalculateEquityCurveUseCase.ts
│   │   │   │   ├── CalculateDrawdownUseCase.ts
│   │   │   │   ├── CalculateWinRateUseCase.ts
│   │   │   │   ├── CalculateRiskMetricsUseCase.ts
│   │   │   │   ├── GetStreakStatsUseCase.ts
│   │   │   │   ├── GetAveragesUseCase.ts
│   │   │   │   ├── GetReturnsByPeriodUseCase.ts
│   │   │   │   ├── GetSessionAnalysisUseCase.ts
│   │   │   │   ├── GetAssetAnalysisUseCase.ts
│   │   │   │   ├── GetBestWorstTradesUseCase.ts
│   │   │   │   ├── GetDailySummaryUseCase.ts
│   │   │   │   ├── GetMonthlyReturnsUseCase.ts
│   │   │   │   ├── GetHourlyPerformanceUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 accounts/                  # Account use cases
│   │   │   │   ├── GetAccountsUseCase.ts
│   │   │   │   ├── AddAccountUseCase.ts
│   │   │   │   ├── RemoveAccountUseCase.ts
│   │   │   │   ├── SyncAccountUseCase.ts
│   │   │   │   ├── RepairAccountHistoryUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 sync/                      # Sync use cases
│   │   │   │   ├── ProcessSyncQueueUseCase.ts
│   │   │   │   ├── QueueSyncJobUseCase.ts
│   │   │   │   ├── GetSyncStatusUseCase.ts
│   │   │   │   ├── TriggerFullSyncUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 auth/                      # Auth use cases
│   │   │   │   ├── LoginUseCase.ts
│   │   │   │   ├── LogoutUseCase.ts
│   │   │   │   ├── RefreshTokenUseCase.ts
│   │   │   │   ├── GetCurrentUserUseCase.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts                      # Use cases barrel
│   │   │
│   │   ├── 📁 ports/                         # Interface definitions (Ports)
│   │   │   │
│   │   │   ├── 📁 repositories/              # Repository interfaces
│   │   │   │   ├── ITradeRepository.ts
│   │   │   │   ├── INoteRepository.ts
│   │   │   │   ├── IObservationRepository.ts
│   │   │   │   ├── ITagRepository.ts
│   │   │   │   ├── IChartBarRepository.ts
│   │   │   │   ├── IAccountRepository.ts
│   │   │   │   ├── ISyncQueueRepository.ts
│   │   │   │   ├── ISettingsRepository.ts
│   │   │   │   ├── IDailySummaryRepository.ts
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 services/                  # External service interfaces
│   │   │   │   ├── ICTraderAPI.ts            # cTrader API contract
│   │   │   │   ├── IAuthService.ts           # Auth service contract
│   │   │   │   ├── IFileExporter.ts          # Export service contract
│   │   │   │   ├── INotificationService.ts   # Push notifications
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 dto/                           # Data Transfer Objects
│   │   │   ├── TradeDTO.ts
│   │   │   ├── TradeNoteDTO.ts
│   │   │   ├── ObservationDTO.ts
│   │   │   ├── TagDTO.ts
│   │   │   ├── ChartBarDTO.ts
│   │   │   ├── AccountDTO.ts
│   │   │   ├── FilterDTO.ts                  # Trade filter criteria
│   │   │   ├── DateRangeDTO.ts
│   │   │   ├── AnalyticsDTO.ts               # Analytics results
│   │   │   ├── SyncStatusDTO.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 mappers/                       # Entity <-> DTO mappers
│   │   │   ├── TradeMapper.ts
│   │   │   ├── NoteMapper.ts
│   │   │   ├── TagMapper.ts
│   │   │   ├── ChartBarMapper.ts
│   │   │   ├── AccountMapper.ts
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts                          # Application barrel
│   │
│   ├── 📁 infrastructure/                    # Infrastructure Layer
│   │   │
│   │   ├── 📁 db/                            # Database implementations
│   │   │   │
│   │   │   ├── 📁 dexie/                     # Dexie/IndexedDB
│   │   │   │   ├── schema.ts                 # Dexie schema definition
│   │   │   │   ├── database.ts               # Dexie database instance
│   │   │   │   ├── migrations.ts             # Schema migrations
│   │   │   │   │
│   │   │   │   ├── 📁 repositories/          # Dexie repository implementations
│   │   │   │   │   ├── DexieTradeRepository.ts
│   │   │   │   │   ├── DexieNoteRepository.ts
│   │   │   │   │   ├── DexieObservationRepository.ts
│   │   │   │   │   ├── DexieTagRepository.ts
│   │   │   │   │   ├── DexieChartBarRepository.ts
│   │   │   │   │   ├── DexieAccountRepository.ts
│   │   │   │   │   ├── DexieSyncQueueRepository.ts
│   │   │   │   │   ├── DexieSettingsRepository.ts
│   │   │   │   │   ├── DexieDailySummaryRepository.ts
│   │   │   │   │   └── index.ts
│   │   │   │   │
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 supabase/                  # Supabase/PostgreSQL
│   │   │   │   ├── client.ts                 # Supabase client instance
│   │   │   │   ├── types.ts                  # Generated Supabase types
│   │   │   │   │
│   │   │   │   ├── 📁 repositories/          # Supabase repository implementations
│   │   │   │   │   ├── SupabaseTradeRepository.ts
│   │   │   │   │   ├── SupabaseNoteRepository.ts
│   │   │   │   │   ├── SupabaseObservationRepository.ts
│   │   │   │   │   ├── SupabaseTagRepository.ts
│   │   │   │   │   ├── SupabaseChartBarRepository.ts
│   │   │   │   │   └── index.ts
│   │   │   │   │
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 api/                           # External API clients
│   │   │   │
│   │   │   ├── 📁 ctrader/                   # cTrader Open API
│   │   │   │   ├── CTraderClient.ts          # Base HTTP client
│   │   │   │   ├── CTraderAuthClient.ts      # OAuth operations
│   │   │   │   ├── CTraderTradeClient.ts     # Trade fetching
│   │   │   │   ├── CTraderHistoryClient.ts   # Historical bars
│   │   │   │   ├── CTraderTypes.ts           # API response types
│   │   │   │   ├── CTraderMapper.ts          # API -> Domain mapping
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 sync/                          # Sync infrastructure
│   │   │   ├── SyncQueueProcessor.ts         # Queue processing logic
│   │   │   ├── ConflictResolver.ts           # Conflict resolution
│   │   │   ├── SyncScheduler.ts              # Background sync scheduling
│   │   │   ├── OnlineStatusMonitor.ts        # Online/offline detection
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 cache/                         # Caching utilities
│   │   │   ├── ChartBarCache.ts              # Time-series cache
│   │   │   ├── TradeListCache.ts             # Trade list cache
│   │   │   ├── CacheManager.ts               # Cache orchestration
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 export/                        # Export implementations
│   │   │   ├── CSVExporter.ts                # CSV export
│   │   │   ├── PDFExporter.ts                # PDF export
│   │   │   ├── JSONExporter.ts               # JSON backup
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 auth/                          # Auth implementation
│   │   │   ├── SupabaseAuthService.ts        # Supabase auth
│   │   │   ├── TokenStorage.ts               # Secure token storage
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts
│   │
│   ├── 📁 ui/                                # UI Layer
│   │   │
│   │   ├── 📁 components/                    # Shared UI components
│   │   │   │
│   │   │   ├── 📁 common/                    # Generic components
│   │   │   │   ├── Button.tsx
│   │   │   │   ├── Input.tsx
│   │   │   │   ├── Select.tsx
│   │   │   │   ├── Modal.tsx
│   │   │   │   ├── Card.tsx
│   │   │   │   ├── Badge.tsx
│   │   │   │   ├── Skeleton.tsx
│   │   │   │   ├── Spinner.tsx
│   │   │   │   ├── EmptyState.tsx
│   │   │   │   ├── ErrorState.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 layout/                    # Layout components
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── AccountSwitcher.tsx
│   │   │   │   ├── SyncStatusBadge.tsx
│   │   │   │   ├── ThemeToggle.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 forms/                     # Form components
│   │   │   │   ├── DateRangePicker.tsx
│   │   │   │   ├── SymbolSelect.tsx
│   │   │   │   ├── DirectionToggle.tsx
│   │   │   │   ├── FilterPanel.tsx
│   │   │   │   ├── TagInput.tsx
│   │   │   │   ├── RatingStars.tsx
│   │   │   │   ├── MindsetSelector.tsx
│   │   │   │   ├── ColorPicker.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 charts/                    # Chart components
│   │   │   │   ├── CandlestickChart.tsx
│   │   │   │   ├── EquityCurve.tsx
│   │   │   │   ├── DrawdownChart.tsx
│   │   │   │   ├── ProfitTimeline.tsx
│   │   │   │   ├── RiskGauge.tsx
│   │   │   │   ├── DonutChart.tsx
│   │   │   │   ├── RadarChart.tsx
│   │   │   │   ├── BarChart.tsx
│   │   │   │   ├── HeatmapGrid.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 tables/                    # Table components
│   │   │   │   ├── DataTable.tsx
│   │   │   │   ├── TradeRow.tsx
│   │   │   │   ├── Pagination.tsx
│   │   │   │   ├── ColumnCustomizer.tsx
│   │   │   │   ├── SortableHeader.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 features/                      # Feature-specific UI modules
│   │   │   │
│   │   │   ├── 📁 dashboard/                 # Dashboard feature
│   │   │   │   ├── DashboardPage.tsx
│   │   │   │   ├── GlobalFilters.tsx
│   │   │   │   ├── SummaryCards.tsx
│   │   │   │   ├── EquitySection.tsx
│   │   │   │   ├── RiskMonitorSection.tsx
│   │   │   │   ├── ReturnsSection.tsx
│   │   │   │   ├── BestWorstTrades.tsx
│   │   │   │   ├── AssetAnalysis.tsx
│   │   │   │   ├── SessionAnalysis.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 trade-list/                # Trade list feature
│   │   │   │   ├── TradeListPage.tsx
│   │   │   │   ├── TradeTable.tsx
│   │   │   │   ├── TradeFilters.tsx
│   │   │   │   ├── InlineRating.tsx
│   │   │   │   ├── InlineMindset.tsx
│   │   │   │   ├── InlineTags.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 trade-detail/              # Trade detail feature
│   │   │   │   ├── TradeDetailPage.tsx
│   │   │   │   ├── TradeHeader.tsx
│   │   │   │   ├── TradeMetricsTab.tsx
│   │   │   │   ├── JournalTab.tsx
│   │   │   │   ├── AIInsightsTab.tsx
│   │   │   │   ├── TradeTagsTab.tsx
│   │   │   │   ├── ChartsTab.tsx
│   │   │   │   ├── ShareTradeButton.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 journal/                   # Rich text journal
│   │   │   │   ├── RichTextEditor.tsx
│   │   │   │   ├── EditorToolbar.tsx
│   │   │   │   ├── ImageUpload.tsx
│   │   │   │   ├── FileAttachment.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 observations/              # Observations feature
│   │   │   │   ├── ObservationsPage.tsx
│   │   │   │   ├── ObservationList.tsx
│   │   │   │   ├── CategorySidebar.tsx
│   │   │   │   ├── ObservationEditor.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 calendar/                  # Calendar/daily journal
│   │   │   │   ├── CalendarPage.tsx
│   │   │   │   ├── MonthlyCalendar.tsx
│   │   │   │   ├── DayCell.tsx
│   │   │   │   ├── DayDetailPanel.tsx
│   │   │   │   ├── CalendarHeader.tsx
│   │   │   │   ├── YearlyGrid.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 tags/                      # Tag management
│   │   │   │   ├── TagCreationModal.tsx
│   │   │   │   ├── TagList.tsx
│   │   │   │   ├── TagBadge.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 accounts/                  # Account management
│   │   │   │   ├── AccountsPage.tsx
│   │   │   │   ├── AccountTable.tsx
│   │   │   │   ├── AddAccountWizard.tsx
│   │   │   │   ├── SyncHealthBanner.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   ├── 📁 auth/                      # Auth UI
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── OAuthCallback.tsx
│   │   │   │   └── index.ts
│   │   │   │
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 hooks/                         # Custom React hooks
│   │   │   ├── useOnlineStatus.ts            # Online/offline detection
│   │   │   ├── useSyncStatus.ts              # Sync state
│   │   │   ├── useAuth.ts                    # Authentication state
│   │   │   ├── useAccount.ts                 # Current account
│   │   │   ├── useTrades.ts                  # Trade queries
│   │   │   ├── useFilters.ts                 # Filter state
│   │   │   ├── useAnalytics.ts               # Analytics data
│   │   │   ├── useChart.ts                   # Chart data loading
│   │   │   ├── useTags.ts                    # Tag operations
│   │   │   ├── useDebounce.ts                # Debounce utility
│   │   │   ├── useLocalStorage.ts            # Local storage
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 state/                         # Zustand stores
│   │   │   ├── authStore.ts                  # Auth state
│   │   │   ├── accountStore.ts               # Current account
│   │   │   ├── filterStore.ts                # Global filters
│   │   │   ├── syncStore.ts                  # Sync status
│   │   │   ├── uiStore.ts                    # UI state (modals, etc.)
│   │   │   └── index.ts
│   │   │
│   │   ├── 📁 providers/                     # React context providers
│   │   │   ├── QueryProvider.tsx             # TanStack Query
│   │   │   ├── ThemeProvider.tsx             # Theme context
│   │   │   ├── AuthProvider.tsx              # Auth context
│   │   │   └── index.ts
│   │   │
│   │   └── index.ts
│   │
│   ├── 📁 config/                            # Configuration
│   │   ├── constants.ts                      # App constants
│   │   ├── env.ts                            # Environment variables
│   │   ├── routes.ts                         # Route definitions
│   │   ├── theme.ts                          # Theme configuration
│   │   └── index.ts
│   │
│   ├── 📁 lib/                               # Utility helpers
│   │   ├── formatters.ts                     # Number, date formatting
│   │   ├── validators.ts                     # Zod schemas
│   │   ├── dateUtils.ts                      # Date calculations
│   │   ├── mathUtils.ts                      # Statistical functions
│   │   ├── classNames.ts                     # cn() utility
│   │   └── index.ts
│   │
│   └── 📁 types/                             # Shared TypeScript types
│       ├── global.d.ts                       # Global type declarations
│       ├── api.ts                            # API response types
│       └── index.ts
│
├── 📁 public/                                # Static assets
│   ├── manifest.json                         # PWA manifest
│   ├── sw.js                                 # Service worker
│   ├── icons/                                # App icons
│   └── images/                               # Static images
│
├── 📁 docs/                                  # Documentation
│   ├── REQUIREMENTS.md                       # Full requirements
│   ├── PLAN.md                               # Execution plan
│   ├── ARCHITECTURE.md                       # This file
│   └── API.md                                # Internal API docs
│
├── 📁 scripts/                               # Build/dev scripts
│   ├── generate-types.ts                     # Supabase type gen
│   └── seed-data.ts                          # Test data seeding
│
├── 📁 tests/                                 # Test files
│   ├── unit/                                 # Unit tests
│   ├── integration/                          # Integration tests
│   └── e2e/                                  # End-to-end tests
│
├── .eslintrc.json                            # ESLint config
├── .prettierrc                               # Prettier config
├── next.config.js                            # Next.js config
├── tailwind.config.js                        # Tailwind config
├── tsconfig.json                             # TypeScript config
├── package.json                              # Dependencies
└── README.md                                 # Project readme
```

---

## 🔌 Dependency Injection

### Pattern: Factory Functions

Since we're using Next.js and avoiding heavy DI frameworks, use factory functions
to wire dependencies:

```typescript
// src/infrastructure/factories/useCaseFactory.ts

import { db } from "@infrastructure/db/dexie/database";
import { DexieTradeRepository } from "@infrastructure/db/dexie/repositories";
import { GetTradesUseCase } from "@application/use-cases/trades";

// Factory creates use case with injected dependencies
export function createGetTradesUseCase(): GetTradesUseCase {
  const tradeRepository = new DexieTradeRepository(db);
  return new GetTradesUseCase(tradeRepository);
}
```

### Hook Integration

```typescript
// src/ui/hooks/useTrades.ts

import { useQuery } from "@tanstack/react-query";
import { createGetTradesUseCase } from "@infrastructure/factories";

export function useTrades(filters: FilterDTO) {
  const useCase = createGetTradesUseCase();

  return useQuery({
    queryKey: ["trades", filters],
    queryFn: () => useCase.execute(filters),
  });
}
```

---

## 🧪 Testing Strategy

### Domain Layer

- Unit tests with Jest/Vitest.
- No mocking needed (pure functions).
- Test business rules and calculations.

### Application Layer

- Unit tests with mocked repositories.
- Test use case orchestration.
- Verify correct port calls.

### Infrastructure Layer

- Integration tests with real Dexie (in-memory).
- Mock external APIs (cTrader, Supabase).
- Test sync and cache behavior.

### UI Layer

- Component tests with React Testing Library.
- E2E tests with Playwright.
- Visual regression tests (optional).

---

## 📏 Import Rules

### Enforced via ESLint

```javascript
// .eslintrc.json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "patterns": [
          // Domain layer cannot import from other layers
          {
            "group": ["@application/*", "@infrastructure/*", "@ui/*"],
            "message": "Domain layer must remain pure."
          }
        ]
      }
    ]
  }
}
```

### Path Aliases

```json
// tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@domain/*": ["./src/domain/*"],
      "@application/*": ["./src/application/*"],
      "@infrastructure/*": ["./src/infrastructure/*"],
      "@ui/*": ["./src/ui/*"],
      "@config/*": ["./src/config/*"],
      "@lib/*": ["./src/lib/*"],
      "@types/*": ["./src/types/*"]
    }
  }
}
```

---

## 🔄 Data Flow Example

### Use Case: View Trade with Chart

```
1. User navigates to /trade/[id]
   └─► TradeDetailPage.tsx (UI)

2. Page renders and fetches data
   ├─► useTrade(id) hook
   │    └─► createGetTradeByIdUseCase()
   │         └─► GetTradeByIdUseCase.execute(id)
   │              ├─► ITradeRepository.findById(id)
   │              │    └─► DexieTradeRepository.findById(id)
   │              └─► Returns Trade entity
   │
   └─► useChart(trade) hook
        └─► createLoadChartWindowUseCase()
             └─► LoadChartWindowUseCase.execute(trade)
                  ├─► Calculate window (entry - 2d, exit + 2d)
                  ├─► IChartBarRepository.findByWindow()
                  │    └─► DexieChartBarRepository (cache first)
                  ├─► If missing: ICTraderAPI.fetchBars()
                  │    └─► CTraderHistoryClient.fetchBars()
                  ├─► Cache new bars
                  └─► Returns ChartBar[]

3. UI renders trade details and chart
   ├─► TradeMetricsTab (uses Trade entity)
   ├─► ChartsTab (uses ChartBar[])
   └─► CandlestickChart component
```

---

## 📚 Reference Dependencies

### Production

```json
{
  "next": "^14.x",
  "react": "^18.x",
  "typescript": "^5.x",
  "dexie": "^4.x",
  "dexie-react-hooks": "^1.x",
  "@supabase/supabase-js": "^2.x",
  "@supabase/auth-helpers-nextjs": "^0.x",
  "zustand": "^4.x",
  "@tanstack/react-query": "^5.x",
  "@tanstack/react-table": "^8.x",
  "lightweight-charts": "^4.x",
  "recharts": "^2.x",
  "@tiptap/react": "^2.x",
  "tailwindcss": "^3.x",
  "@radix-ui/react-*": "latest",
  "framer-motion": "^11.x",
  "date-fns": "^3.x",
  "zod": "^3.x",
  "lucide-react": "latest"
}
```

### Development

```json
{
  "@types/react": "^18.x",
  "eslint": "^8.x",
  "prettier": "^3.x",
  "vitest": "^1.x",
  "@testing-library/react": "^14.x",
  "playwright": "^1.x"
}
```

---

## ✅ Quality Gates Checklist

- [ ] Domain layer has zero imports from other layers.
- [ ] Application layer has zero infrastructure imports (only ports).
- [ ] UI components call use cases, never raw APIs.
- [ ] All repositories implement their port interfaces.
- [ ] Unit tests cover domain business logic.
- [ ] Integration tests cover repository implementations.
- [ ] E2E tests cover critical user flows.
- [ ] TypeScript strict mode enabled.
- [ ] ESLint rules enforced.
- [ ] PWA works offline.
