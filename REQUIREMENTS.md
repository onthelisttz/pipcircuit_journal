# Smart Trading Journal - Requirements

This document defines the comprehensive requirements for an offline-first trading journal
with high performance, using cTrader Open API. Features are informed by UI analysis of
iridio dashboard and trader waves reference designs.

---

## 1. Functional Requirements

### 1.1 Core Journal Features

- **Trade journal**: List, view, search, filter, tag, rate, and comment on trades.
- **Trade detail view**: Candlestick chart with entry/exit context and annotations.
- **Offline-first**: Full read/write functionality offline with queued sync.
- **Initial sync**: Fetch full trade history and chart windows from cTrader Open API.
- **Incremental sync**: Detect new trades and updates efficiently.
- **Multi-device support**: Cloud backup and cross-device sync via Supabase.

### 1.2 Trade Detail View

- **Trade Metrics Tab**:
  - Trade information: Order Type badge (Buy/Sell), Symbol, Lots/Volume.
  - Time information: Open Time, Close Time (with timezone).
  - Price summary: Open Price, Close Price.
  - Transaction costs: Commission, Swap, Fee (separate fields).
  - Trade results: Gross Profit, Net Profit, Percent Gain.
- **Journal Tab**:
  - Rich text editor (Tiptap) with full formatting toolbar.
  - Toolbar: Bold, Italic, Underline, Strikethrough, Text color, Highlight.
  - Advanced: Headings (H1-H6), Bullet lists, Numbered lists, Blockquotes.
  - Media: Image upload, File attachments, Clipboard paste support.
- **AI Insights Tab** (Optional Pro):
  - AI-powered trade analysis.
  - Pattern recognition and suggestions.
  - Gated feature with Pro badge.
- **Trade Tags Tab**:
  - Star rating (1-5 stars).
  - Mindset/mood selector with emoji presets: Happy 😊, Sad 😢, Anxious 😰, Excited 🤩, Neutral 😐.
  - Tag categories:
    - Strategy tags (e.g., "breakout", "trend-following").
    - Mistakes tags (e.g., "early entry", "overtrading").
    - Custom tags (user-defined).
  - Tag creation with color picker (preset + full spectrum).
- **Charts Tab**:
  - Candlestick chart using TradingView Lightweight Charts.
  - Timeframe selector (M1, M5, M15, M30, H1, H4, D1).
  - Reset View button.
  - Profit Timeline toggle overlay.
  - MAE (Maximum Adverse Excursion) indicator.
  - MFE (Maximum Favorable Excursion) indicator.
  - Floating profit timeline below chart.
- **Share Trade Action**: Export/share trade view as image or link.

### 1.3 Market Observations

- **Purpose**: General market analysis and notes independent of specific trades.
- **Structure**:
  - **Categories**: Create/Edit/Delete categories (e.g., "Macro Analysis", "Daily Bias", "Crypto").
  - **Entries**: Individual observation posts within categories.
- **Entry Content**:
  - **Title**: Short descriptive title.
  - **Rich Text Editor**: Full formatting (Quill/Tiptap) with bold, italic, lists, headers.
  - **Media**: Image upload/paste support (screenshots of charts).
- **Navigation**: Dedicated "Observations" section in sidebar.

---

## 2. Chart Data Requirements (Performance Critical)

### 2.1 Windowed Loading

- Load only a time window around the trade: entry - 2 days to exit + 2 days.
- Adaptive window: Scale context based on trade duration.

### 2.2 Lazy Loading

- Load earlier/later chunks on scroll (infinite scroll pattern).
- Detect scroll position near edges (20% threshold).
- Preload ±1 window in each direction (background).

### 2.3 Cache Hierarchy

- **Primary**: Dexie (IndexedDB) for instant offline access.
- **Secondary**: Supabase (cloud) for multi-device backup.
- **Fallback**: cTrader API for missing/fresh data.

### 2.4 Data Optimization

- Deduplicate bars: Store bars once per symbol/timeframe/timestamp.
- Timeframe aggregation: Cache lower timeframes, aggregate to higher.
- Compression: Use efficient storage for historical data.
- Memory cap: Keep ≤ 5000 bars per chart view in memory.

---

## 3. Offline and Sync Requirements

### 3.1 Local Database

- **Dexie/IndexedDB** as primary store.
- Tables: trades, comments, tags, chart_bars, accounts, sync_queue, sync_meta, settings.
- Compound indexes for efficient queries: `[symbol+timeframe+timestamp]`.

### 3.2 Sync Queue

- Ordered processing with exponential backoff retries.
- Queue fields: action (create/update/delete), table, data, timestamp, retry_count.
- Visual sync status indicator.

### 3.3 Conflict Resolution

- Strategy: Last-write-wins using timestamps/version fields.
- Each record has: created_at, updated_at, synced_at, version.
- Optional: Show conflicts to user for important data.

### 3.4 Background Sync

- Online event listener + interval fallback.
- Service Worker Background Sync API.
- Manual sync button (always available).

---

## 4. Security and Privacy

### 4.1 Authentication

### 4.1 Authentication

- **Primary Auth**: Google Sign-In via Supabase Auth.
- **Trading Accounts**: Link multiple cTrader accounts after signing in.
- **Context Switching**:
  - Valid OAuth tokens stored per trading account.
  - Global account switcher in navbar to toggle active data view.
  - "Add Account" flow to link new cTrader IDs.
- **Session**: Persist user session and active account preference.

### 4.2 Data Protection

- Supabase Row Level Security for user data isolation.
- HTTPS only for all communications.
- Optional local encryption for sensitive data (Web Crypto API).
- No third-party analytics by default.

---

## 5. Non-Functional Requirements (High Performance)

### 5.1 Performance Targets

- **Fast app start**: Load local data immediately (< 300ms from Dexie).
- **Chart load**: Cached window in < 1 second.
- **Trade list**: Virtualized for large datasets (1000+ trades smooth).
- **Memory**: ≤ 5000 bars per chart view in memory.
- **Sync**: Queue processing does not block UI.

### 5.2 Minimal API Calls

- Aggressive caching strategy.
- Rate-limit aware fetching for cTrader API.
- Batch requests where possible.

---

## 6. Analytics and Dashboard Requirements

### 6.1 Global Filters

- **Symbol multi-select**: Search and select multiple trading pairs.
- **Direction filter**: Buy, Sell, or Both.
- **Date range picker**: Dual-calendar with visual range selection.
- **Time zone selector**: Display times in user's preferred timezone.
- **Quick range shortcuts**:
  - Today, Yesterday
  - Last 7 days, Last 30 days
  - This month, Last month
  - Last 3 months, Last 6 months
  - This year, Last year
  - All time
- **Auto-sync toggle**: Automatically sync date range across views.
- **"In The Last" option**: Dynamic rolling windows.

### 6.2 Equity and Performance Summary Cards

- **Net Profit**: Total P&L with color coding (green/red).
- **Total Trades**: Count of all trades in selection.
- **Win Rate**: Percentage of winning trades.
- **Max Drawdown**: Maximum percentage drop from peak.
- **Total Deposits**: Sum of all deposits.
- **Percentage from Peak**: Current level vs. all-time high.
- **Breakeven Trades**: Count of trades with zero P&L.

### 6.3 Equity Curve Chart

- Line chart showing equity balance over time.
- Toggle to show/hide deposits and withdrawals markers.
- Hover tooltips with exact values and dates.
- Zoom and pan capabilities.

### 6.4 Drawdown Chart

- Area chart (inverted) showing drawdown percentage over time.
- Description: "Percentage from the highest value reached so far."
- Color-coded severity levels.

### 6.5 Risk Monitor Gauges (Dial Indicators)

- **Profit Factor**: Ratio of gross profits to gross losses.
- **Z Score**: Statistical measure of trading system reliability.
- **Sharpe Ratio**: Risk-adjusted return metric.
- **Sortino Ratio**: Downside risk-adjusted return metric.
- Visual gauges with color zones (red/yellow/green).

### 6.6 Streak Statistics

- **Maximum Consecutive Wins**: Longest winning streak.
- **Maximum Consecutive Losses**: Longest losing streak.
- Historical streak tracking.

### 6.7 Per-Trade Averages

- **Average Win**: Mean profit on winning trades.
- **Average Loss**: Mean loss on losing trades.
- **Average Risk/Reward**: Mean R:R ratio achieved.
- **Average Profit/Loss**: Overall mean P&L per trade.
- **Average Holding Period**: Mean trade duration.

### 6.8 Long/Short Statistics

- Total Long Trades count.
- Total Short Trades count.
- P&L breakdown by direction.
- Win rate by direction.

### 6.9 Returns Breakdown

#### 6.9.1 Annual Returns Bar Chart

- Stacked bar chart by year.
- Green for profits, red for losses.
- Year selector toggle (e.g., "2025", "2026").

#### 6.9.2 Monthly Returns Heatmap

- Grid with months as columns, years as rows.
- Color-coded cells (red for negative, green for positive).
- Percentage values displayed in cells.
- Clickable cells to drill down.

#### 6.9.3 Trade Distribution by Month

- Bar chart showing trade count per month.
- Win/loss split with stacked colors.
- Year toggle buttons.
- Hover tooltips with detailed breakdown.

#### 6.9.4 Trades by Month

- Similar to distribution but focused on count.
- Wins in green, losses in red.

#### 6.9.5 Gain/Losses by Day of Week

- Bar chart (Mon-Sun).
- Stacked green/red showing daily P&L.
- Hover with winning/losing percentages.

#### 6.9.6 Gain/Losses by Hour of Day

- 24-hour bar chart (00:00-23:00).
- Stacked green/red showing hourly P&L.
- Identify best/worst trading hours.

### 6.10 Trade Outcome Distribution by Month

- Stacked bar chart showing outcome types per month.
- Categories: Take Profit, Stop Loss, Breakeven, Partials.
- Color legend for each category.
- Hover with exact counts.

### 6.11 Best and Worst Trade Detail Cards

- **Best Trade Card** (green border):
  - Full trade details: ID, Symbol, Direction, Open/Close dates.
  - Prices, Volume, P&L, Commission, Swap.
  - MaxProfit, MaxLoss (MAE/MFE), BalanceOpen, BalanceClose.
- **Worst Trade Card** (red border):
  - Same fields as Best Trade.
- Side-by-side layout.

### 6.12 Asset Analysis

- **Trade Count by Asset**: Donut/pie chart.
- **P&L by Asset**: Donut chart showing profit distribution.
- **Win Rate by Asset**: Donut chart showing success by symbol.
- Color legend with symbol names.

### 6.13 Session Analysis

- **Trade Count by Session**: Radar/spider chart.
- **P&L by Session**: Radar chart.
- **Win Rate by Session**: Radar chart.
- Sessions: New York, London, Asia, Out of Session.
- Overlapped or side-by-side display.

---

## 7. Navigation and App Sections

### 7.1 Left Navigation (Sidebar)

- **Dashboard**: Main analytics view.
- **Journal**: Trade journaling section.
- **Observations**: Market observations and analysis.
- **Accounts**: Connected trading accounts.
- **Optional Modules** (expandable):
  - Leaderboard (future).
  - Copier (future).
  - Simulator (future).
  - Charts (future).
  - Crypto (future).

### 7.2 Journal Section Tabs

- **Trade History**: Full trade list with all columns.
- **Daily Journal**: Calendar-based journaling.
- **Library**: Saved content and templates.

### 7.3 Library Sub-tabs

- **Trade Journals**: Individual trade journal entries.
- **Daily Journals**: Daily summary entries.
- **Strategy Section**: Documented trading strategies.
- **Templates**: Reusable journal templates.

---

## 8. Trade List and Table Requirements

### 8.1 Trade History Table

- **Sortable columns**: Click headers to sort asc/desc.
- **Pagination**: Page numbers, "Go to page" input.
- **Page size selector**: Show 10, 25, 50, 100.
- **Actions column**: Quick actions per trade.
- **Inline editing**: Edit rating, mindset, tags directly in table.

### 8.2 Column Set (Customizable)

- **Core**: Symbol, Order Type (Buy/Sell badge), Open Time, Close Time.
- **Prices**: Open Price, Close Price.
- **Size**: Volume/Lots.
- **Results**: Gross Profit, Net Profit, Percent Gain.
- **Costs**: Commission, Swap, Fee.
- **Levels**: Take Profit, Stop Loss.
- **Metadata**: Ticket ID, Trade Comment, Magic Number.
- **Duration**: Hold Time (formatted duration).
- **Source**: Placed By (Algo, Dealer, Manual, Mobile).
- **Journal**: Rating (stars), Mindset (emoji), Strategy Tags, Mistakes Tags, Custom Tags.

### 8.3 Column Customization Panel

- Toggleable sidebar with checkboxes.
- Grouped by category.
- Persist column preferences.
- Reset to defaults option.

### 8.4 Search and Filter Panel

- **Symbol search**: Autocomplete search field.
- **Date range picker**: Dual calendar with presets.
- **Filter tabs**: Trade Filters, Journal Filters.
- **AI-Powered Filtering** (Optional): Toggle for smart filters.
- **Trade Filters**:
  - Order Type: Buy, Sell, Balance (checkboxes).
  - Profit Range: Min/Max inputs.
  - Hold Time: Min/Max inputs.
  - Volume Range: Min/Max inputs.
  - Placed By: Algo, Dealer, Manual, Mobile (checkboxes).
- **Journal Filters**:
  - Rating range.
  - Mindset selection.
  - Tag filters (strategy, mistakes, custom).
- **Filter actions**: Apply Filters, Clear Filters buttons.

---

## 9. Daily Journal and Calendar Views

### 9.1 Daily Journal Calendar

- Monthly calendar grid view.
- Each day cell shows:
  - Net P&L (amount).
  - Percentage change.
  - Trade count.
- Color coding: Green for profit, red for loss.
- Week totals in rightmost column.
- Navigation: Previous/Next month buttons.
- Toggle: Percent view vs. Trade count view.

### 9.2 Calendar Header Stats

- **Total Trades**: Count for visible month.
- **Wins**: Count and percentage.
- **Profits**: Net P&L for month.
- **Percent**: Overall month percentage.

### 9.3 Day Detail Popup/Panel

- **Header**: Date and Net P&L (amount + percentage).
- **Balance Summary**:
  - Start Balance.
  - End Balance.
  - Deposit.
  - Commissions & Fees.
- **Trading Stats**:
  - Buys count, Sells count, Total Trades.
  - Best Trade (P&L).
  - Worst Trade (P&L).
  - Average Hold Time.
  - Max Drawdown.
- **Performance Metrics**: Winrate, Profit Factor, Expectancy.
- **Intraday P&L Curve**: Small line chart showing equity during day.
- **Link**: "View In Journal" to full journal entry.

### 9.4 Yearly Performance Grid

- Grid showing monthly returns for each year.
- Similar to heatmap but more compact.
- Clickable months for drill-down.

---

## 10. Tags and Metadata Management

### 10.1 Tag Creation Modal

- **Tag Name**: Text input field.
- **Tag Color**:
  - Preset color swatches (blue, orange, green, yellow, pink, purple, gray).
  - Full color picker (gradient + hue slider).
- **Preview**: Live preview of tag badge.
- **Actions**: Create, Cancel buttons.

### 10.2 Tag Categories

- **Strategy Tags**: Trading strategy identifiers.
- **Mistakes Tags**: Common trading errors.
- **Custom Tags**: User-defined categories.

### 10.3 Mindset/Mood Selection

- **Preset options** with emojis:
  - 😊 Happy
  - 😢 Sad
  - 😰 Anxious
  - 🤩 Excited
  - 😐 Neutral
- Dropdown selector with emoji + text.
- Visible in trade list (emoji only) and detail view (full).

### 10.4 Rating System

- 5-star rating scale.
- Clickable/hoverable stars.
- Inline editing in trade list.
- Filter by rating range.

---

## 11. Accounts and Sync UI

### 11.1 Accounts List Table

- **Columns**: Name, Number, Server, Type (Demo/Live), Platform, Balance, Connection, Last Sync, Actions.
- **Type badge**: Color-coded Demo (green) vs. Live (red) indicator.
- **Connection status**: Online/Offline indicator.
- **Actions**: Edit, Sync, Delete icons.

### 11.2 Account Actions

- **Add Account**: Flow to connect new cTrader account.
- **Sync All**: Button to sync all connected accounts.
- **Per-account sync**: Individual sync buttons.
- **Account history repair**: Action to fix sync issues.

### 11.3 Account Switcher (Top Bar)

- Dropdown showing current account.
- Demo/Live badge visible.
- Quick switch between accounts.

### 11.4 Sync Health Indicators

- **Banner**: "Issues syncing? Try an account history repair" (when applicable).
- **Status badge**: Sync in progress, Synced, Error states.
- **Last sync timestamp**: "X ago" or exact time.
- **Pending changes count**: "3 changes pending sync".

---

## 12. AI and Pro Features

### 12.1 AI Insights Tab

- Trade analysis and pattern recognition.
- Market context at time of trade.
- Suggestions for improvement.
- Gated as Pro feature with upgrade prompt.

### 12.2 AI-Powered Filtering

- Toggle in filters panel.
- Natural language filter queries.
- Smart tag suggestions.
- Pro feature badge.

---

## 13. UI/UX Requirements

### 13.1 Theme and Styling

- **Dark mode**: Primary theme (as shown in references).
- Light mode option.
- Modern color palette with accent colors.
- Glassmorphism effects where appropriate.
- Smooth animations and transitions (Framer Motion).

### 13.2 Responsiveness

- Desktop-first design.
- Tablet-friendly layouts.
- Mobile-optimized views for key features.

### 13.3 Loading States

- Skeleton loaders for content.
- Progress indicators for sync.
- Spinner overlays for actions.
- Empty states with guidance.

### 13.4 Offline Indicators

- Global sync status badge:
  - 🟢 Online & synced.
  - 🟡 Online, syncing...
  - 🔴 Offline (changes pending).
- Pending changes count.
- Manual sync button.

---

## 14. Architecture and Quality Requirements

### 14.1 Clean Architecture

- **Domain Layer**: Entities, value objects, business rules (no framework imports).
- **Application Layer**: Use cases, ports/interfaces, DTOs, mappers.
- **Infrastructure Layer**: Dexie repos, Supabase clients, cTrader API clients.
- **UI Layer**: React components, hooks, Zustand stores.

### 14.2 SOLID Principles

- **Single Responsibility**: One reason to change per module.
- **Open/Closed**: Extend via new implementations.
- **Liskov Substitution**: Interfaces honored by all implementations.
- **Interface Segregation**: Small, focused interfaces.
- **Dependency Inversion**: Core depends on abstractions only.

### 14.3 Quality Gates

- Domain layer: Zero framework imports.
- UI components: Use application layer only, no raw API calls.
- Infrastructure: Replaceable without changing domain.

---

## 15. Export and Backup

### 15.1 Data Export

- Export trades as CSV/Excel.
- Export journal entries as PDF.
- Export chart snapshots as images.

### 15.2 Local Backup

- Full backup to JSON file.
- Restore from backup file.
- Automatic periodic backups (optional).

---

## 16. Future Considerations

### 16.1 Planned Modules

- Leaderboard: Social trading rankings.
- Copier: Copy trading integration.
- Simulator: Paper trading mode.
- Multi-platform: MT4/MT5 support.
- Cryptocurrency: Crypto exchange integration.

### 16.2 Scalability

- Support for 10,000+ trades.
- Multiple account management.
- Team/organization features.
