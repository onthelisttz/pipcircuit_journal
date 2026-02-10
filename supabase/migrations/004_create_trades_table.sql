-- Create trades table - full schema matching Dexie Trade entity
-- user_id for RLS; account_id + ticket_id for dedup with cTrader

CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  ticket_id TEXT,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('Buy', 'Sell')),
  order_type TEXT NOT NULL CHECK (order_type IN ('Market', 'Limit', 'Stop')),
  open_time TIMESTAMPTZ NOT NULL,
  close_time TIMESTAMPTZ,
  open_price DECIMAL NOT NULL,
  close_price DECIMAL,
  entry_price DECIMAL,
  volume DECIMAL NOT NULL,
  lots DECIMAL,
  commission DECIMAL,
  swap DECIMAL,
  fee DECIMAL,
  gross_profit DECIMAL,
  net_profit DECIMAL,
  percent_gain DECIMAL,
  take_profit DECIMAL,
  stop_loss DECIMAL,
  placed_by TEXT CHECK (placed_by IN ('Algo', 'Dealer', 'Manual', 'Mobile')),
  outcome TEXT CHECK (outcome IN ('TakeProfit', 'StopLoss', 'Breakeven', 'Partial', 'Manual')),
  rating INTEGER,
  mindset TEXT CHECK (mindset IN ('Happy', 'Sad', 'Anxious', 'Excited', 'Neutral')),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1,
  UNIQUE(user_id, account_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_account ON trades(user_id, account_id);
CREATE INDEX IF NOT EXISTS idx_trades_user_symbol ON trades(user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON trades(user_id, open_time);

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own trades" ON trades;
CREATE POLICY "Users can only access their own trades"
  ON trades FOR ALL USING (auth.uid() = user_id);
