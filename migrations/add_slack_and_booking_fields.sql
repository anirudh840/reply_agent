-- Migration: Add Slack and Booking integration fields to agents table
-- Run this in Supabase SQL Editor

-- Slack Integration
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS slack_webhook_url TEXT;

-- Booking Integration
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS booking_platform TEXT;

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS booking_api_key TEXT;

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS booking_event_id TEXT;

ALTER TABLE agents
ADD COLUMN IF NOT EXISTS booking_link TEXT;

-- Comments
COMMENT ON COLUMN agents.slack_webhook_url IS 'Slack incoming webhook URL for interested reply notifications';
COMMENT ON COLUMN agents.booking_platform IS 'Calendar booking platform: cal_com or calendly';
COMMENT ON COLUMN agents.booking_api_key IS 'API key for the booking platform';
COMMENT ON COLUMN agents.booking_event_id IS 'Selected event type ID from the booking platform';
COMMENT ON COLUMN agents.booking_link IS 'Public booking page URL for the selected event type';
