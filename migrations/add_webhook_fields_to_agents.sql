-- Migration: Add webhook fields to agents table
-- Run this in Supabase SQL Editor

-- Add webhook_id column (unique identifier for agent's webhook URL)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS webhook_id TEXT UNIQUE;

-- Add webhook_secret column (optional, for webhook verification)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS webhook_secret TEXT;

-- Create index on webhook_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_agents_webhook_id ON agents(webhook_id);

-- Add comment
COMMENT ON COLUMN agents.webhook_id IS 'Unique identifier for this agent''s webhook URL';
COMMENT ON COLUMN agents.webhook_secret IS 'Secret for webhook signature verification (optional)';
