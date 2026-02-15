-- Add followup_sent boolean to interested_leads table
-- Tracks whether the agent has sent a scheduled followup (not the first response)
ALTER TABLE interested_leads ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT FALSE;

-- Backfill: mark existing leads that have gone through at least one followup stage
UPDATE interested_leads SET followup_sent = TRUE WHERE followup_stage > 0;
