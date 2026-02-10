-- Create daily_summaries table - full schema matching Dexie DailySummary entity

CREATE TABLE IF NOT EXISTS daily_summaries (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL,
  date DATE NOT NULL,
  net_profit DECIMAL NOT NULL,
  gross_profit DECIMAL NOT NULL,
  trades_count INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  win_rate DECIMAL NOT NULL,
  max_drawdown DECIMAL NOT NULL,
  average_win DECIMAL NOT NULL,
  average_loss DECIMAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, account_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_user ON daily_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_account_date ON daily_summaries(user_id, account_id, date);

ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own daily summaries" ON daily_summaries;
CREATE POLICY "Users can only access their own daily summaries"
  ON daily_summaries FOR ALL USING (auth.uid() = user_id);
