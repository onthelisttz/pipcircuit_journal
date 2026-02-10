-- Create symbol_sync_progress table for tracking chart bar sync progress
-- Tracks sync status for each broker+symbol combination

CREATE TABLE IF NOT EXISTS symbol_sync_progress (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  broker TEXT NOT NULL,
  symbol TEXT NOT NULL,
  first_bar_date TIMESTAMPTZ,
  last_bar_date TIMESTAMPTZ,
  last_sync_time TIMESTAMPTZ,
  total_bars INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'completed', 'failed')),
  error TEXT,
  progress_percent INTEGER DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, broker, symbol)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_symbol_sync_progress_lookup
  ON symbol_sync_progress(user_id, broker, symbol);

CREATE INDEX IF NOT EXISTS idx_symbol_sync_progress_status
  ON symbol_sync_progress(user_id, status);

CREATE INDEX IF NOT EXISTS idx_symbol_sync_progress_broker
  ON symbol_sync_progress(user_id, broker);

-- Enable Row Level Security
ALTER TABLE symbol_sync_progress ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own sync progress
DROP POLICY IF EXISTS "Users can only access their own sync progress" ON symbol_sync_progress;
CREATE POLICY "Users can only access their own sync progress"
  ON symbol_sync_progress
  FOR ALL
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_symbol_sync_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS symbol_sync_progress_updated_at ON symbol_sync_progress;
CREATE TRIGGER symbol_sync_progress_updated_at
  BEFORE UPDATE ON symbol_sync_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_symbol_sync_progress_updated_at();
