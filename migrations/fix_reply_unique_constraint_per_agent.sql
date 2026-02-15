-- Migration: Fix reply unique constraint to be per-agent
-- This allows the same platform reply to be processed by multiple agents independently
-- Run this in Supabase SQL Editor

-- Step 1: Drop the old global unique constraint on emailbison_reply_id
ALTER TABLE replies DROP CONSTRAINT IF EXISTS replies_emailbison_reply_id_key;

-- Step 2: Also drop the unique index if it exists separately
DROP INDEX IF EXISTS replies_emailbison_reply_id_key;

-- Step 3: Add composite unique constraint (agent_id + emailbison_reply_id)
ALTER TABLE replies ADD CONSTRAINT replies_agent_emailbison_reply_unique
  UNIQUE (agent_id, emailbison_reply_id);
