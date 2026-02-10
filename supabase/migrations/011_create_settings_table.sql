-- Create settings table - key-value store matching Dexie settings
-- key is the primary key; value is JSONB for flexibility

CREATE TABLE IF NOT EXISTS settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own settings" ON settings;
CREATE POLICY "Users can only access their own settings"
  ON settings FOR ALL USING (auth.uid() = user_id);
