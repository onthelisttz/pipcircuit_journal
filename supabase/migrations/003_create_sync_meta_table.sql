-- Create sync_meta table for tracking sync metadata per account
-- Stores last sync time and last synced trade ID

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, -- Composite key: userId:accountId
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  last_sync_time TIMESTAMPTZ,
  last_trade_id TEXT,
  version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_sync_meta_user_account
  ON sync_meta(user_id, account_id);

CREATE INDEX IF NOT EXISTS idx_sync_meta_user
  ON sync_meta(user_id);

CREATE INDEX IF NOT EXISTS idx_sync_meta_last_sync_time
  ON sync_meta(last_sync_time);

-- Enable Row Level Security
ALTER TABLE sync_meta ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own sync metadata
DROP POLICY IF EXISTS "Users can only access their own sync metadata" ON sync_meta;
CREATE POLICY "Users can only access their own sync metadata"
  ON sync_meta
  FOR ALL
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_sync_meta_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS sync_meta_updated_at ON sync_meta;
CREATE TRIGGER sync_meta_updated_at
  BEFORE UPDATE ON sync_meta
  FOR EACH ROW
  EXECUTE FUNCTION update_sync_meta_updated_at();
