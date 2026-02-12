-- Sync hardening migration:
-- 1) Stable client-side identity (client_id) for non-bar entities
-- 2) Soft-delete tombstones (deleted_at) for reliable cross-device deletes
-- 3) Metadata for deterministic sync (device_id/version/updated_at)
-- 4) One-time tag dedupe and trade_tag remap

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ========== tags ==========
ALTER TABLE tags ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE tags ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

UPDATE tags SET client_id = gen_random_uuid() WHERE client_id IS NULL;
ALTER TABLE tags ALTER COLUMN client_id SET NOT NULL;

-- Drop legacy unique to allow soft-delete semantics.
ALTER TABLE tags DROP CONSTRAINT IF EXISTS tags_user_id_name_category_key;

-- One-time dedupe of active tags by normalized name/category (case/space tolerant).
WITH ranked AS (
  SELECT
    id,
    user_id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(trim(name)), category
      ORDER BY created_at ASC, id ASC
    ) AS rn,
    MIN(id) OVER (
      PARTITION BY user_id, lower(trim(name)), category
    ) AS canonical_id
  FROM tags
  WHERE deleted_at IS NULL
),
dups AS (
  SELECT id, canonical_id
  FROM ranked
  WHERE rn > 1
)
UPDATE trade_tags tt
SET
  tag_id = d.canonical_id
FROM dups d
WHERE tt.tag_id = d.id
;

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, lower(trim(name)), category
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM tags
  WHERE deleted_at IS NULL
)
UPDATE tags t
SET
  deleted_at = NOW(),
  updated_at = NOW(),
  synced_at = NOW(),
  version = COALESCE(t.version, 1) + 1
FROM ranked r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_client_id
  ON tags(user_id, client_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tags_user_name_category_active
  ON tags(user_id, lower(trim(name)), category)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tags_user_updated_at
  ON tags(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tags_user_deleted_at
  ON tags(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ========== trade_notes ==========
ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE trade_notes ADD COLUMN IF NOT EXISTS device_id TEXT;

UPDATE trade_notes SET client_id = gen_random_uuid() WHERE client_id IS NULL;
ALTER TABLE trade_notes ALTER COLUMN client_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_notes_user_client_id
  ON trade_notes(user_id, client_id);

CREATE INDEX IF NOT EXISTS idx_trade_notes_user_updated_at
  ON trade_notes(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_notes_user_deleted_at
  ON trade_notes(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ========== observations ==========
ALTER TABLE observations ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE observations ADD COLUMN IF NOT EXISTS device_id TEXT;

UPDATE observations SET client_id = gen_random_uuid() WHERE client_id IS NULL;
ALTER TABLE observations ALTER COLUMN client_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_observations_user_client_id
  ON observations(user_id, client_id);

CREATE INDEX IF NOT EXISTS idx_observations_user_updated_at
  ON observations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_observations_user_deleted_at
  ON observations(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ========== observation_categories ==========
ALTER TABLE observation_categories ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE observation_categories ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE observation_categories ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE observation_categories ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE observation_categories ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

UPDATE observation_categories SET client_id = gen_random_uuid() WHERE client_id IS NULL;
ALTER TABLE observation_categories ALTER COLUMN client_id SET NOT NULL;

ALTER TABLE observation_categories DROP CONSTRAINT IF EXISTS observation_categories_user_id_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_observation_categories_user_client_id
  ON observation_categories(user_id, client_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_observation_categories_user_name_active
  ON observation_categories(user_id, lower(trim(name)))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_observation_categories_user_updated_at
  ON observation_categories(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_categories_user_deleted_at
  ON observation_categories(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;

-- ========== trade_tags ==========
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS client_id UUID;
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS device_id TEXT;
ALTER TABLE trade_tags ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;

UPDATE trade_tags SET client_id = gen_random_uuid() WHERE client_id IS NULL;
ALTER TABLE trade_tags ALTER COLUMN client_id SET NOT NULL;

ALTER TABLE trade_tags DROP CONSTRAINT IF EXISTS trade_tags_user_id_trade_id_tag_id_key;

-- Remove duplicate active trade-tag links before adding partial unique index.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, trade_id, tag_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM trade_tags
  WHERE deleted_at IS NULL
)
UPDATE trade_tags tt
SET
  deleted_at = NOW(),
  updated_at = NOW(),
  synced_at = NOW(),
  version = COALESCE(tt.version, 1) + 1
FROM ranked r
WHERE tt.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_tags_user_client_id
  ON trade_tags(user_id, client_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_tags_user_trade_tag_active
  ON trade_tags(user_id, trade_id, tag_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trade_tags_user_updated_at
  ON trade_tags(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_trade_tags_user_deleted_at
  ON trade_tags(user_id, deleted_at DESC)
  WHERE deleted_at IS NOT NULL;
