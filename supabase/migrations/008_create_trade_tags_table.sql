-- Create trade_tags table - junction table for trade-tag links

CREATE TABLE IF NOT EXISTS trade_tags (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id BIGINT NOT NULL,
  tag_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, trade_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_tags_user ON trade_tags(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_trade ON trade_tags(user_id, trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_tags_tag ON trade_tags(user_id, tag_id);

ALTER TABLE trade_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own trade tags" ON trade_tags;
CREATE POLICY "Users can only access their own trade tags"
  ON trade_tags FOR ALL USING (auth.uid() = user_id);
