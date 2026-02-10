-- Create observation_categories table - full schema matching Dexie ObservationCategory entity

CREATE TABLE IF NOT EXISTS observation_categories (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_observation_categories_user ON observation_categories(user_id);

ALTER TABLE observation_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can only access their own observation categories" ON observation_categories;
CREATE POLICY "Users can only access their own observation categories"
  ON observation_categories FOR ALL USING (auth.uid() = user_id);
