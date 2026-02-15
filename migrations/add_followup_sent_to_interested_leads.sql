-- Add followup_sent boolean to interested_leads table
-- Tracks whether the agent has sent at least one response to this lead
ALTER TABLE interested_leads ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT FALSE;

-- Backfill: mark existing leads that already had a response sent
UPDATE interested_leads SET followup_sent = TRUE WHERE last_response_sent IS NOT NULL;
