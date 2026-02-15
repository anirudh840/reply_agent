-- Create meetings_booked table to track booked meetings
CREATE TABLE IF NOT EXISTS meetings_booked (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES interested_leads(id) ON DELETE SET NULL,
  lead_email TEXT NOT NULL,
  lead_name TEXT,
  meeting_url TEXT,
  booking_platform TEXT,
  booked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for querying by agent
CREATE INDEX IF NOT EXISTS idx_meetings_booked_agent_id ON meetings_booked(agent_id);

-- Index for date range queries (dashboard chart)
CREATE INDEX IF NOT EXISTS idx_meetings_booked_booked_at ON meetings_booked(booked_at);
