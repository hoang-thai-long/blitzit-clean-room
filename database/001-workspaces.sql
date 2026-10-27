-- New Daylight schema. Compatible with the desktop snapshot repository.
-- This migration is idempotent and never replaces existing workspace data.
CREATE TABLE IF NOT EXISTS daylight_workspaces (
  id text PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0,
  state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daylight_workspaces_updated_at_idx
  ON daylight_workspaces (updated_at DESC);
