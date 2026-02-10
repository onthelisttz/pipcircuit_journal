-- Create tags table - full schema matching Dexie Tag entity

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Strategy', 'Mistakes', 'Custom')),
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, name, category)
);

CREATE INDEX IF NOT EXISTS idx_tags_user ON tags(user_id);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own tags" ON tags;
CREATE POLICY "Users can only access their own tags"
  ON tags FOR ALL USING (auth.uid() = user_id);
