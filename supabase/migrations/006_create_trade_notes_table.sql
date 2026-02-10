-- Create trade_notes table - full schema matching Dexie TradeNote entity

CREATE TABLE IF NOT EXISTS trade_notes (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id BIGINT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  synced_at TIMESTAMPTZ,
  version INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_trade_notes_user ON trade_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_notes_trade ON trade_notes(user_id, trade_id);

ALTER TABLE trade_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own trade notes" ON trade_notes;
CREATE POLICY "Users can only access their own trade notes"
  ON trade_notes FOR ALL USING (auth.uid() = user_id);
