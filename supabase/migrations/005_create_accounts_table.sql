-- Create accounts table - full schema matching Dexie Account entity

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ctrader_account_id BIGINT,
  account_number TEXT NOT NULL,
  platform TEXT NOT NULL,
  broker TEXT,
  server TEXT,
  name TEXT,
  type TEXT CHECK (type IN ('Demo', 'Live')),
  currency TEXT,
  balance DECIMAL,
  equity DECIMAL,
  leverage INTEGER,
  is_active BOOLEAN DEFAULT false,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, account_number)
);

CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own accounts" ON accounts;
CREATE POLICY "Users can only access their own accounts"
  ON accounts FOR ALL USING (auth.uid() = user_id);
