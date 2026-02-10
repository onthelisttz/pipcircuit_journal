-- Create chart_bars table for storing OHLCV chart data
-- Broker-based storage allows sharing bars across accounts with same broker

CREATE TABLE IF NOT EXISTS chart_bars (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1')),
  timestamp BIGINT NOT NULL,
  open DECIMAL NOT NULL,
  high DECIMAL NOT NULL,
  low DECIMAL NOT NULL,
  close DECIMAL NOT NULL,
  volume BIGINT NOT NULL DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, broker, symbol, timeframe, timestamp)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chart_bars_lookup 
  ON chart_bars(user_id, broker, symbol, timeframe, timestamp);

CREATE INDEX IF NOT EXISTS idx_chart_bars_window 
  ON chart_bars(user_id, broker, symbol, timestamp);

CREATE INDEX IF NOT EXISTS idx_chart_bars_user_broker 
  ON chart_bars(user_id, broker);

CREATE INDEX IF NOT EXISTS idx_chart_bars_synced_at 
  ON chart_bars(synced_at);

-- Enable Row Level Security
ALTER TABLE chart_bars ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own chart bars
DROP POLICY IF EXISTS "Users can only access their own chart bars" ON chart_bars;
CREATE POLICY "Users can only access their own chart bars"
  ON chart_bars
  FOR ALL
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_chart_bars_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS chart_bars_updated_at ON chart_bars;
CREATE TRIGGER chart_bars_updated_at
  BEFORE UPDATE ON chart_bars
  FOR EACH ROW
  EXECUTE FUNCTION update_chart_bars_updated_at();
