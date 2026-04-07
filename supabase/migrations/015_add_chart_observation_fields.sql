ALTER TABLE observations
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS chart_context JSONB;

UPDATE observations
SET source = 'manual'
WHERE source IS NULL;

ALTER TABLE observations
  ALTER COLUMN source SET DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_observations_user_source
  ON observations(user_id, source);
