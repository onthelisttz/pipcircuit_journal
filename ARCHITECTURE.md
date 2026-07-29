# Architecture — Clean Architecture & SOLID

This document defines the architectural principles, layering, and structure for the pipCircuit application. Business logic remains independent from frameworks, databases, and UI.

---

## Architectural Goals

1. **Testability** — Domain and application logic testable without frameworks.
2. **Maintainability** — Clear boundaries reduce coupling.
3. **Scalability** — Easy to add features without restructuring.
4. **Flexibility** — Swap infrastructure (DB, API) without changing business logic.
5. **Offline-First** — Local IndexedDB (Dexie) as primary store, Supabase as cloud sync.

---

## SOLID Principles

| Principle | Application |
|---|---|
| **SRP** | Each module has one reason to change. Use cases handle one operation. Components render one concern. |
| **OCP** | Extend behavior via new implementations behind interfaces. |
| **LSP** | All repository implementations honor their port interfaces — any can replace another. |
| **ISP** | Small, focused interfaces. Clients depend only on methods they use. |
| **DIP** | High-level modules don't depend on low-level modules. Both depend on abstractions. Domain and Application layers have zero infrastructure imports. |

---

## Layer Architecture

```
┌─────────────────────────────────────┐
│            UI Layer                 │
│  Next.js Pages, React Components,   │
│  Hooks, Zustand Stores, Providers   │
└──────────────────┬──────────────────┘
                   │ calls
                   ▼
┌─────────────────────────────────────┐
│        Application Layer            │
│  Use Cases, DTOs, Mappers,         │
│  Port Interfaces (repositories,    │
│  services)                          │
└──────────────────┬──────────────────┘
                   │ uses
                   ▼
┌─────────────────────────────────────┐
│          Domain Layer               │
│  Entities, Value Objects, Enums,   │
│  Domain Services, Domain Errors    │
└──────────────────┬──────────────────┘
                   ▲ implements
                   │
┌─────────────────────────────────────┐
│      Infrastructure Layer           │
│  Dexie/Supabase Repositories,      │
│  cTrader/MT5 API Clients,          │
│  Sync Engines, Cache, Auth, Export │
└─────────────────────────────────────┘
```

**Dependency Rule:** Dependencies only point inward. Infrastructure depends on Application (ports), which depends on Domain. UI depends on Application. Domain depends on nothing.

---

## Project Structure

```
src/
│
├── app/                                 # Next.js App Router
│   ├── (auth)/                          # Auth route group
│   │   ├── login/page.tsx
│   │   ├── callback/page.tsx
│   │   └── ctrader-callback/page.tsx
│   ├── (app)/                           # Authenticated route group
│   │   ├── dashboard/page.tsx
│   │   ├── trades/page.tsx
│   │   ├── journal/page.tsx
│   │   ├── chart/page.tsx
│   │   ├── history/page.tsx
│   │   ├── observations/page.tsx
│   │   ├── accounts/page.tsx
│   │   ├── tags/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── debug/page.tsx
│   │   └── layout.tsx
│   ├── api/                             # API routes
│   │   └── ctrader/, supabase/, etc.
│   ├── layout.tsx                       # Root layout
│   ├── page.tsx                         # Entry page
│   ├── loading.tsx
│   ├── not-found.tsx
│   └── globals.css
│
├── domain/                              # Pure Business Logic
│   ├── entities/                        # Trade, TradeNote, Observation, Tag,
│   │                                   # Account, ChartBar, DailySummary, etc.
│   ├── value-objects/                   # Money, TimeRange, DateRange, Symbol,
│   │                                   # PriceLevel, TradeResult
│   ├── enums/                           # Direction, OrderType, TradeOutcome,
│   │                                   # Session, Mindset, SyncAction, etc.
│   ├── services/                        # SessionClassifier, etc.
│   ├── errors/                          # DomainError, ValidationError, etc.
│   └── index.ts
│
├── application/                         # Use Cases & Ports
│   ├── use-cases/                       # trades/, journal/, observations/,
│   │                                   # tags/, charts/, analytics/,
│   │                                   # accounts/, sync/, auth/
│   ├── ports/
│   │   ├── repositories/               # ITradeRepository, INoteRepository, etc.
│   │   └── services/                   # ICTraderAPI, IAuthService, etc.
│   ├── dto/                             # TradeDTO, FilterDTO, AnalyticsDTO, etc.
│   ├── mappers/                         # TradeMapper, NoteMapper, etc.
│   └── index.ts
│
├── infrastructure/                      # Implementations
│   ├── db/
│   │   ├── dexie/                       # IndexedDB (Dexie) — schema, database, repos
│   │   ├── supabase/                    # PostgreSQL (Supabase) — client, repos
│   │   └── Dual*.ts                     # Dual repos: read from Dexie, write to both
│   ├── api/
│   │   └── ctrader/                     # CTraderClient, Auth, History, Trade clients
│   ├── mt5/                             # MT5 history bridge
│   ├── sync/                            # SyncOrchestrator, BarSyncWorker,
│   │                                   # FullSyncService, DeltaSync, queues, etc.
│   ├── auth/                            # SupabaseAuthService, TokenStorage
│   ├── cache/                           # ChartBarCache, etc.
│   ├── export/                          # CSV/JSON exporters
│   └── index.ts
│
├── ui/                                  # React Layer
│   ├── components/
│   │   ├── charts/                      # TradeCandlestickChart (6k LOC),
│   │   │                               # ChartControls, ChartLayoutGrid,
│   │   │                               # ProfitTimelineChart, TimeGuides, etc.
│   │   ├── common/                      # ConfirmDialog, DateRangePopover,
│   │   │                               # RichTextEditor, TradePositionInput
│   │   ├── layout/                      # AppLogo, AuthGuard, Header, Sidebar,
│   │   │                               # SyncStatusBadge
│   │   ├── panels/                      # TradePanel, ObservationPanel,
│   │   │                               # TradeJournalEditor, TradeTagsTab
│   │   ├── settings/                    # BrokerSyncSection, SyncSettings
│   │   ├── sync/                        # SyncInitializer
│   │   └── pwa/                         # ServiceWorkerRegistration
│   ├── features/
│   │   ├── auth/                        # LoginPage
│   │   ├── trade-detail/                # TradeDetailView, TradeChartTab
│   │   └── trade-list/                  # Table views
│   ├── hooks/                           # useAuth, useTradesByQuery, useChartData,
│   │                                   # useObservations, useRealtimeSync, etc.
│   ├── providers/                       # AuthProvider, ThemeProvider,
│   │                                   # TradePanelProvider, etc.
│   ├── state/                           # Zustand: authStore, accountStore,
│   │                                   # syncProgressStore, etc.
│   └── index.ts
│
├── config/                              # env.ts, ctrader.ts, index.ts
├── lib/                                 # Utilities: color, date-range, pnl, mt5
└── types/                               # Shared TypeScript types
```

---

## Data Flow Example

```
User navigates to /trade/[id]
  └─► TradeDetailView (feature)
       └─► useTrade(id) hook
            └─► use case: GetTradeByIdUseCase
                 └─► ITradeRepository.findById(id)
                      └─► DexieTradeRepository (local)
                           └─► falls back to SupabaseTradeRepository
       └─► useChartData(trade) hook
            └─► use case: LoadChartWindowUseCase
                 ├─► IChartBarRepository.findByWindow()
                 │    └─► DexieChartBarRepository
                 └─► If missing: ICTraderAPI.fetchBars()
                      └─► CTraderHistoryClient
```

---

## Testing Strategy

| Layer | Approach |
|---|---|
| **Domain** | Unit tests, no mocking needed (pure functions) |
| **Application** | Unit tests with mocked repository interfaces |
| **Infrastructure** | Integration tests with in-memory Dexie, mock external APIs |
| **UI** | Component tests with React Testing Library |

```bash
bun test              # all tests
bun test tests/unit   # unit tests
bun test tests/integration  # integration tests
```

---

## Key Packages (as used)

| Package | Version |
|---|---|
| next | 16.1.5 |
| react / react-dom | 19.2.3 |
| typescript | 5.x (strict) |
| lightweight-charts | 5.1.0 |
| dexie | 4.2.1 |
| @supabase/supabase-js | 2.93.1 |
| @supabase/ssr | 0.8.0 |
| zustand | 5.0.10 |
| @tanstack/react-query | 5.90.20 |
| @tiptap/react | 3.17.1 |
| tailwindcss | 4.x |
| framer-motion | 12.29.2 |
| recharts | 3.7.0 |
| zod | 4.3.6 |
| vitest | 4.0.18 |
| lucide-react | 0.563.0 |
