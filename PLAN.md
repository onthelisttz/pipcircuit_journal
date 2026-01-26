# Smart Trading Journal - Execution Plan

This plan outlines the phased implementation approach following Clean Architecture and SOLID
principles. Each phase has clear goals, deliverables, and exit criteria.

---

## Overview

**Total Estimated Duration**: 8-12 weeks

| Phase | Name                      | Duration  | Dependencies |
| ----- | ------------------------- | --------- | ------------ |
| 0     | Foundation & Architecture | 3-5 days  | None         |
| 1     | Domain & Data Layer       | 5-7 days  | Phase 0      |
| 2     | cTrader API Integration   | 5-8 days  | Phase 1      |
| 3     | Charts & Visualization    | 6-10 days | Phase 2      |
| 4     | Sync Engine               | 5-8 days  | Phase 1      |
| 5     | Analytics Dashboard       | 8-12 days | Phase 2      |
| 6     | Journal & Tagging         | 5-8 days  | Phase 2      |
| 7     | Trade List & Filters      | 5-7 days  | Phase 2      |
| 8     | Calendar & Daily Journal  | 4-6 days  | Phase 5      |
| 9     | Accounts & Multi-Device   | 4-6 days  | Phase 4      |
| 10    | Polish & QA               | 5-8 days  | All          |
| 11    | Deployment                | 2-4 days  | Phase 10     |

---

## Phase 0 - Foundation & Architecture (3-5 days)

### Goals

- Establish project scaffolding with strict architecture boundaries.
- Create design system and base layout.
- Configure PWA for offline capability.

### Key Tasks

1. **Project Setup**
   - Initialize Next.js 14 with App Router + TypeScript.
   - Configure Tailwind CSS + CSS variables for theming.
   - Setup shadcn/ui component library.
   - Add ESLint, Prettier, and strict TypeScript config.

2. **Core Dependencies**
   - Install Dexie.js for IndexedDB.
   - Install @supabase/supabase-js.
   - Install Zustand for state management.
   - Install TanStack Query for data fetching.
   - Install lightweight-charts for TradingView charts.
   - Install Framer Motion for animations.
   - Install Tiptap for rich text editing.
   - Install date-fns for date handling.
   - Install zod for validation.

3. **Architecture Setup**
   - Create folder structure per Clean Architecture.
   - Define layer boundaries and import rules.
   - Setup path aliases (@domain, @application, @infrastructure, @ui).

4. **PWA Configuration**
   - Add next-pwa or custom service worker.
   - Configure manifest.json.
   - Setup offline cache strategy.
   - Add install prompt handler.

5. **Base Layout**
   - Create app shell with sidebar navigation.
   - Implement dark theme as default.
   - Add responsive layout breakpoints.
   - Create loading and error boundary components.

### Deliverables

- Running app shell with navigation layout.
- Architecture documentation with folder structure.
- PWA installable with offline landing page.
- Design tokens and theme configuration.

### Exit Criteria

- `npm run dev` starts without errors.
- App installs as PWA.
- Clean Architecture boundaries enforced via linting.

---

## Phase 1 - Domain & Data Layer (5-7 days)

### Goals

- Define domain entities and business rules.
- Implement local database schema.
- Create repository interfaces and implementations.

### Key Tasks

1. **Domain Entities**
   - `Trade`: Core trading record with all fields.
   - `TradeNote`: Journal entry linked to trade.
   - `Observation`: Market observation entry.
   - `ObservationCategory`: Category for observations.
   - `Tag`: User-defined tag with category and color.
   - `ChartBar`: OHLCV bar data.
   - `Account`: Trading account credentials/metadata.
   - `SyncJob`: Queue item for offline sync.
   - `DailySummary`: Aggregated daily statistics.

2. **Value Objects**
   - `Money`: Currency + amount with formatting.
   - `TimeRange`: Start/end timestamp pair.
   - `Symbol`: Trading pair identifier.
   - `DateRange`: Date range with presets.

3. **Enums**
   - `Direction`: Buy, Sell.
   - `OrderType`: Market, Limit, Stop.
   - `TradeOutcome`: TakeProfit, StopLoss, Breakeven, Partial, Manual.
   - `Session`: NewYork, London, Asia, OutOfSession.
   - `Mindset`: Happy, Sad, Anxious, Excited, Neutral.
   - `PlacedBy`: Algo, Dealer, Manual, Mobile.

4. **Dexie Schema**

   ```javascript
   trades: "++id, accountId, symbol, direction, openTime, closeTime, [symbol+openTime]";
   trade_notes: "++id, tradeId, createdAt";
   tags: "++id, category, name, color";
   trade_tags: "++id, tradeId, tagId, [tradeId+tagId]";
   observations: "++id, categoryId, title, createdAt";
   observation_categories: "++id, name, color";
   chart_bars: "++id, [symbol+timeframe+timestamp], symbol, timeframe";
   accounts: "++id, accountNumber, platform";
   sync_queue: "++id, action, table, entityId, timestamp, retryCount";
   sync_meta: "accountId, lastSyncTime, lastTradeId";
   settings: "key, value";
   daily_summaries: "++id, accountId, date, [accountId+date]";
   ```

5. **Repository Interfaces** (Application Layer)
   - `ITradeRepository`: CRUD + queries for trades.
   - `INoteRepository`: CRUD for trade notes.
   - `IObservationRepository`: CRUD for observations.
   - `ITagRepository`: CRUD + bulk operations for tags.
   - `IChartBarRepository`: Windowed loading queries.
   - `IAccountRepository`: Account management.
   - `ISyncQueueRepository`: Queue operations.

6. **Dexie Implementations** (Infrastructure Layer)
   - `DexieTradeRepository`
   - `DexieNoteRepository`
   - `DexieObservationRepository`
   - `DexieTagRepository`
   - `DexieChartBarRepository`
   - `DexieAccountRepository`
   - `DexieSyncQueueRepository`

### Deliverables

- Complete domain model with all entities.
- Working Dexie database with migrations.
- Repository implementations with full CRUD.
- Offline detection hook and status indicator.

### Exit Criteria

- All CRUD operations work offline.
- Unit tests pass for domain logic.
- Schema migrations work correctly.

---

## Phase 2 - Authentication & Accounts (5-8 days)

### Goals

- Implement Google Sign-In.
- Build cTrader account linking flow.
- Handle active account context switching.

### Key Tasks

1. **Primary Authentication**
   - Setup Supabase Auth with Google Provider.
   - Create Login page.
   - Create Protected Route wrapper.
   - Handle session persistence.

2. **cTrader Account Linking**
   - "Add Account" button -> cTrader OAuth redirect.
   - Callback handler: Exchange code for token.
   - Store cTrader token against user ID (not just local).
   - Fetch trading account details (ID, Broker, Type).

3. **Active Account Context**
   - Global `useActiveAccount` hook/store.
   - Changing account triggers data refresh/filtering.
   - UI indicator for current active account.

4. **cTrader API Integration**
   - `CTraderAuthClient`: OAuth operations.
   - `CTraderTradeClient`: Fetch trades for _linked_ account.
   - `CTraderHistoryClient`: Fetch OHLCV bars.
   - Rate limiter utility (≤100 requests/minute).
   - Retry logic with exponential backoff.

5. **Trade Import Use Case**
   - `ImportTradesUseCase`: Orchestrate full import.
   - Batch fetching by date range (chunks).
   - Map cTrader response to domain entities.
   - Detect duplicates by ticket ID.
   - Progress reporting callback.

6. **Chart Data Import Use Case**
   - `ImportChartWindowUseCase`: Fetch bars for trade.
   - Calculate window: entry - 2 days to exit + 2 days.
   - Request bars in chunks (≤ 5000 per request).
   - Deduplicate by symbol + timeframe + timestamp.

7. **Account Connection Flow**
   - Add account UI wizard.
   - Validate credentials.
   - Initial sync trigger.

### Deliverables

- Google Sign-In working.
- Ability to link multiple cTrader accounts.
- Account switcher in navbar updates view.
- Offline support for multiple accounts.

### Exit Criteria

- User can sign in, link cTrader, and switch between accounts.

---

## Phase 3 - Charts & Visualization (6-10 days)

### Goals

- Implement high-performance trade charting.
- Add profit timeline and MAE/MFE overlays.
- Enable timeframe switching with lazy loading.

### Key Tasks

1. **Chart Component**
   - Integrate TradingView Lightweight Charts.
   - Candlestick series with OHLCV data.
   - Price scale customization.
   - Time scale with timezone support.
   - Dark theme styling.

2. **Trade Context Visualization**
   - Entry marker (vertical line + annotation).
   - Exit marker (vertical line + annotation).
   - Trade duration highlight zone.
   - Direction indicator (buy/sell colors).

3. **Profit Timeline Overlay**
   - Line series below main chart.
   - Shows floating P&L during trade.
   - MAE marker (lowest point).
   - MFE marker (highest point).
   - Toggle visibility.

4. **Windowed Loading**
   - `LoadChartWindowUseCase`: Fetch window around trade.
   - Adaptive window size based on trade duration.
   - Cache-first fetching (Dexie → Supabase → cTrader).

5. **Lazy Loading (Infinite Scroll)**
   - Detect scroll near edges (20% threshold).
   - Fetch previous/next chunks.
   - Prepend/append to chart data.
   - Loading indicators at edges.

6. **Timeframe Switching**
   - Timeframe selector (M1 to D1).
   - Maintain time context on switch.
   - Aggregate from lower timeframes when possible.
   - Reset View button.

### Deliverables

- Fast-loading trade charts with context.
- Profit timeline with MAE/MFE.
- Smooth infinite scroll for history.
- Timeframe switching.

### Exit Criteria

- Chart renders in < 1 second from cache.
- Scrolling loads more data seamlessly.
- Memory stays within 5000 bar limit.

---

## Phase 4 - Sync Engine (5-8 days)

### Goals

- Implement bidirectional sync with Supabase.
- Handle conflicts gracefully.
- Enable multi-device consistency.

### Key Tasks

1. **Supabase Schema**
   - Mirror Dexie tables in PostgreSQL.
   - Row Level Security policies.
   - Timestamps: created_at, updated_at, synced_at.
   - Version field for optimistic locking.

2. **Sync Queue Processor**
   - `ProcessSyncQueueUseCase`: Process pending changes.
   - Ordered processing (oldest first).
   - Exponential backoff on failures.
   - Max retry limit with alerting.

3. **Conflict Resolution**
   - Last-write-wins strategy.
   - Compare updated_at timestamps.
   - Optional: Surface conflicts for user review.

4. **Background Sync**
   - Online/offline event listeners.
   - Periodic sync interval (5 minutes).
   - Service Worker Background Sync.
   - Manual sync trigger.

5. **Sync UI**
   - Sync status badge (online/syncing/offline).
   - Pending changes count.
   - Last sync timestamp.
   - Manual sync button.

### Deliverables

- Reliable sync queue with retries.
- Conflict resolution working.
- Multi-device data consistency.
- Sync status indicators.

### Exit Criteria

- Offline edits sync when back online.
- No data loss during conflicts.
- Sync does not block UI.

---

## Phase 5 - Analytics Dashboard (8-12 days)

### Goals

- Build comprehensive analytics dashboard.
- Implement all charts and metrics from requirements.
- Optimize for performance with large datasets.

### Key Tasks

1. **Analytics Use Cases**
   - `CalculateEquityCurveUseCase`
   - `CalculateDrawdownUseCase`
   - `CalculateWinRateUseCase`
   - `CalculateRiskMetricsUseCase`: Profit factor, Sharpe, Sortino, Z-score.
   - `GetStreakStatsUseCase`
   - `GetAveragesUseCase`
   - `GetReturnsByPeriodUseCase`: Annual, monthly, daily.
   - `GetPerformanceBySessionUseCase`
   - `GetPerformanceByAssetUseCase`
   - `GetBestWorstTradesUseCase`

2. **Global Filters Component**
   - Symbol multi-select with search.
   - Direction toggle (Buy/Sell/Both).
   - Date range picker with dual calendar.
   - Quick presets dropdown.
   - Time zone selector.
   - Auto-sync toggle.

3. **Summary Cards Row**
   - Net Profit, Total Trades, Win Rate, Max Drawdown.
   - Total Deposits, Percentage from Peak, Breakeven Trades.
   - Animated number transitions.

4. **Equity Curve Chart**
   - Line chart with Recharts.
   - Deposits/withdrawals toggle.
   - Zoom and pan.

5. **Drawdown Chart**
   - Area chart (inverted).
   - Color gradient for severity.

6. **Risk Gauge Components**
   - Dial gauge for Profit Factor, Z Score, Sharpe, Sortino.
   - Color zones (red/yellow/green).

7. **Returns Charts**
   - Annual returns stacked bar.
   - Monthly heatmap grid.
   - Trade distribution by month.
   - Trades by month stacked bar.
   - Gain/loss by day of week.
   - Gain/loss by hour of day.
   - Trade outcomes by month.

8. **Best/Worst Trade Cards**
   - Side-by-side layout.
   - Full trade details.
   - Color-coded borders.

9. **Asset Analysis Section**
   - Three donut charts: Count, P&L, Win Rate by Asset.

10. **Session Analysis Section**
    - Three radar charts: Count, P&L, Win Rate by Session.

### Deliverables

- Complete dashboard with all widgets.
- Global filters working across all charts.
- Responsive layout.
- Optimized computations.

### Exit Criteria

- All analytics match requirements.
- Dashboard loads in < 2 seconds.
- Filters update all charts reactively.

---

## Phase 6 - Journal & Tagging (5-8 days)

### Goals

- Implement rich trade journaling.
- Build comprehensive tagging system.
- Add rating and mindset features.

### Key Tasks

1. **Trade Detail Modal/Page**
   - Tab navigation: Metrics, Journal, AI Insights, Trade Tags, Charts.
   - Trade navigation (prev/next trade arrows).
   - Share Trade button.

2. **Trade Metrics Tab**
   - Trade Information section.
   - Price Summary section.
   - Transaction Costs section.
   - Trade Results section.
   - Formatted values with colors.

3. **Journal Tab (Rich Text Editor)**
   - Tiptap editor integration.
   - Full toolbar: Bold, Italic, Underline, Strikethrough.
   - Colors: Text color, Highlight.
   - Structure: Headings, Lists, Blockquotes.
   - Media: Image upload, File attachments.
   - Autosave to Dexie.

4. **Trade Tags Tab**
   - 5-star rating component.
   - Mindset selector dropdown with emojis.
   - Strategy Tags section with create button.
   - Mistakes Tags section with create button.
   - Custom Tags section with create button.

5. **Tag Management**
   - Tag creation modal.
   - Tag name input.
   - Color picker (presets + full picker).
   - Tag preview badge.
   - Tag category assignment.

6. **AI Insights Tab** (Optional/Pro)
   - Placeholder with Pro upgrade prompt.
   - Future: API integration for analysis.

### Deliverables

- Complete trade detail view with all tabs.
- Working rich text journal.
- Full tagging system with colors.
- Rating and mindset capture.

### Exit Criteria

- Can journal any trade with rich formatting.
- Tags are searchable and filterable.
- All journal data syncs offline/online.

---

## Phase 7 - Market Observations (4-6 days)

### Goals

- Create standalone observations module.
- Build categorization system.
- Implement rich text editor with image support.

### Key Tasks

1. **Observation Domain**
   - Define entities: `Observation`, `ObservationCategory`.
   - Setup Dexie/Supabase tables.

2. **Category Management**
   - Sidebar/Modal for managing categories.
   - Create/Edit/Delete categories.
   - Color coding for categories.

3. **Observation List**
   - List view filtered by category.
   - Search by title/content.
   - Sort by date created/updated.

4. **Observation Editor**
   - Reuse Tiptap editor from Journal.
   - Add Title input.
   - Add Category selector.
   - Image upload handler (Storage bucket integration).

### Deliverables

- Full Observations section in sidebar.
- Rich text editor with image support.
- Category management.

### Exit Criteria

- Can create, edit, and view observations with images.
- Categories organize content effectively.

---

## Phase 8 - Trade List & Filters (5-7 days)

### Goals

- Build high-performance trade list table.
- Implement comprehensive filtering.
- Add inline editing capabilities.

### Key Tasks

1. **Trade List Table**
   - Virtualized table for large datasets (TanStack Table + Virtual).
   - Sortable columns.
   - Pagination with page size options.
   - Actions column.

2. **Column Configuration**
   - All columns from requirements.
   - Column visibility toggle panel.
   - Persist preferences to settings.
   - Drag-and-drop reordering (optional).

3. **Inline Editing**
   - Rating stars (click to edit).
   - Mindset dropdown (click to edit).
   - Tags (click to add/remove).
   - Auto-save on change.

4. **Filters Panel**
   - Slide-out sidebar.
   - Trade Filters tab.
   - Journal Filters tab.
   - Symbol search with autocomplete.
   - Order Type checkboxes.
   - Profit Range min/max inputs.
   - Hold Time min/max inputs.
   - Volume Range min/max inputs.
   - Placed By checkboxes.
   - AI-Powered Filtering toggle (Pro).

5. **Date Range Picker**
   - Dual calendar component.
   - Quick preset buttons.
   - Auto-sync toggle.
   - "In The Last" option.
   - Apply/Cancel buttons.

### Deliverables

- Fast, searchable trade list.
- All filter options working.
- Inline editing functional.
- Column customization.

### Exit Criteria

- 1000+ trades scroll smoothly.
- Filters apply instantly.
- Inline edits sync correctly.

---

## Phase 9 - Calendar & Daily Journal (4-6 days)

### Goals

- Implement calendar-based daily journal.
- Build daily summary view.
- Add yearly performance grid.

### Key Tasks

1. **Daily Journal Calendar**
   - Monthly grid view.
   - Per-day P&L display (amount + percent).
   - Trade count per day.
   - Color coding (green/red).
   - Week totals column.

2. **Calendar Navigation**
   - Previous/Next month buttons.
   - Month/year selector dropdown.
   - Jump to today.

3. **Calendar Header Stats**
   - Total Trades for month.
   - Wins count and percentage.
   - Net Profits for month.
   - Overall percentage.
   - Toggle: Percent vs. Trades view.

4. **Day Detail Panel**
   - Slide-out or modal when clicking day.
   - Header: Date, Net P&L.
   - Balance summary: Start, End, Deposit, Fees.
   - Trading stats: Buys, Sells, Best, Worst, Avg Hold, Drawdown.
   - Performance: Winrate, Profit Factor, Expectancy.
   - Intraday P&L curve (small line chart).
   - "View In Journal" link.
   - Trade list for that day.

5. **Yearly Performance Grid**
   - Monthly returns grid by year.
   - Compact heatmap style.
   - Clickable for drill-down.

### Deliverables

- Full calendar interface.
- Day detail with stats and chart.
- Yearly performance overview.

### Exit Criteria

- Can navigate any month/year.
- Day details accurate.
- Links to full journal work.

---

## Phase 10 - Accounts & Multi-Device (4-6 days)

### Goals

- Build account management interface.
- Enable multi-account support.
- Ensure multi-device sync works.

### Key Tasks

1. **Accounts Page**
   - Accounts table with all columns.
   - Google Profile section (Sign out).
   - Demo/Live badge styling.
   - Connection status indicators.
   - Last sync display.
   - Action buttons (sync, edit, delete).

2. **Add Account Flow**
   - "Link cTrader Account" button.
   - OAuth redirect.
   - Handle callback and store token.
   - Initial sync trigger.
   - Progress display.

3. **Account Switcher**
   - Top bar dropdown.
   - Current account display.
   - Quick switch.
   - Demo/Live badge.

4. **Sync Health UI**
   - Warning banner for sync issues.
   - "Account history repair" action.
   - Detailed sync log (expandable).

5. **Multi-Device Testing**
   - Verify sync across devices.
   - Test conflict scenarios.
   - Validate data consistency.

### Deliverables

- Complete accounts management.
- Working account switcher.
- Sync health monitoring.

### Exit Criteria

- Multiple accounts can be connected.
- Switching accounts updates UI.
- Sync works across devices.

---

## Phase 11 - Polish & QA (5-8 days)

### Goals

- Refine UX and performance.
- Fix bugs and edge cases.
- Ensure production readiness.

### Key Tasks

1. **UX Polish**
   - Loading states for all async operations.
   - Empty states with guidance.
   - Error states with retry options.
   - Skeleton loaders.
   - Micro-animations.

2. **Performance Optimization**
   - Profile and optimize slow components.
   - Lazy load non-critical features.
   - Image optimization.
   - Bundle size analysis.

3. **Accessibility**
   - Keyboard navigation.
   - Screen reader compatibility.
   - ARIA labels.
   - Color contrast.

4. **Export/Import**
   - Export trades to CSV.
   - Export journal to PDF.
   - Full backup as JSON.
   - Restore from backup.

5. **Testing**
   - Unit tests for domain logic.
   - Integration tests for use cases.
   - E2E tests for critical flows.
   - Offline testing.
   - Sync integrity tests.

6. **Documentation**
   - User guide.
   - API documentation (internal).
   - Contribution guidelines.

### Deliverables

- Polished, stable application.
- Comprehensive test coverage.
- User documentation.

### Exit Criteria

- No critical bugs.
- Performance targets met.
- Tests passing.

---

## Phase 12 - Deployment (2-4 days)

### Goals

- Deploy to production.
- Configure monitoring.
- Go live.

### Key Tasks

1. **Vercel Deployment**
   - Configure project.
   - Set environment variables.
   - Enable preview deployments.
   - Custom domain (optional).

2. **Supabase Production**
   - Create production project.
   - Run migrations.
   - Configure RLS policies.
   - Setup backups.

3. **Monitoring**
   - Error tracking (Sentry or similar).
   - Performance monitoring.
   - Uptime alerts.

4. **Final Checks**
   - Smoke tests on production.
   - PWA installation test.
   - Sync test with real accounts.
   - Security audit.

### Deliverables

- Live production environment.
- Monitoring configured.
- Documentation updated.

### Exit Criteria

- App is live and stable.
- PWA installable from production.
- All critical paths working.

---

## Performance Targets Summary

| Metric                         | Target       |
| ------------------------------ | ------------ |
| Trade list load (Dexie cache)  | < 300ms      |
| Chart load (cached window)     | < 1s         |
| Dashboard load                 | < 2s         |
| Bars in memory per chart       | ≤ 5000       |
| Sync queue processing          | Non-blocking |
| Time to First Contentful Paint | < 1.5s       |
| Time to Interactive            | < 3s         |

---

## cTrader API Guidelines

- Fetch trades in batches by date range.
- Respect rate limits (≤ 100 requests/minute).
- Request bars in chunks (≤ 5000 per request).
- Cache aggressively; avoid re-fetching old data.
- Historical data (> 30 days) is immutable.

---

## Risk Mitigation

| Risk                      | Mitigation                                |
| ------------------------- | ----------------------------------------- |
| cTrader API rate limits   | Implement request queue with throttling   |
| Large dataset performance | Virtualization, pagination, lazy loading  |
| Offline sync conflicts    | Last-write-wins with optional user review |
| IndexedDB storage limits  | Data compression, cleanup old data        |
| OAuth token expiry        | Proactive refresh, graceful re-auth       |

---

## Success Criteria

1. ✅ Fully functional offline-first PWA.
2. ✅ One-click sync with cTrader.
3. ✅ Comprehensive analytics dashboard.
4. ✅ Rich journaling with tags and ratings.
5. ✅ Fast, responsive UI.
6. ✅ Multi-device sync.
7. ✅ Zero monthly cost (free tiers).
