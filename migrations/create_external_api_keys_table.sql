-- Migration: Create external_api_keys table for 3rd party API access
-- This allows external apps to read responded-to leads and campaign metrics

CREATE TABLE IF NOT EXISTS external_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  name TEXT NOT NULL,                    -- Human-readable label (e.g. "Dashboard App")
  key_hash TEXT NOT NULL UNIQUE,         -- SHA-256 hash of the API key
  key_prefix TEXT NOT NULL,              -- First 8 chars for identification (e.g. "eb_live_a1b2...")
  agent_ids UUID[] NOT NULL DEFAULT '{}', -- Which agents this key can access (empty = all)
  scopes TEXT[] NOT NULL DEFAULT '{read:campaigns,read:leads}', -- Permission scopes
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ                 -- NULL = active, set = revoked
);

-- Index for fast key lookup by hash
CREATE INDEX idx_external_api_keys_hash ON external_api_keys (key_hash) WHERE revoked_at IS NULL;

-- Index for listing active keys
CREATE INDEX idx_external_api_keys_active ON external_api_keys (created_at DESC) WHERE revoked_at IS NULL;
