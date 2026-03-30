-- Migration: Create send_log table and acquire_send_lock function
-- Purpose: Prevent duplicate replies by providing atomic send-level deduplication
-- across all 6 send paths (webhook, cron, followup, approve, manual, legacy_approve)

-- =============================================================================
-- 1. send_log table
-- =============================================================================
CREATE TABLE IF NOT EXISTS send_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- What we're sending to
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES interested_leads(id) ON DELETE SET NULL,
  lead_email TEXT NOT NULL,

  -- Idempotency key: prevents duplicate sends for the same trigger
  -- Key formats:
  --   "reply-to:{platform_reply_id}"   — webhook/cron/approve auto-sends
  --   "followup:{lead_id}:{stage}"     — followup sends
  --   "manual:{lead_id}:{ts_bucket}"   — manual sends (double-click guard)
  idempotency_key TEXT NOT NULL,

  -- Which code path initiated the send
  send_source TEXT NOT NULL CHECK (
    send_source IN ('webhook', 'cron', 'followup', 'approve', 'manual', 'legacy_approve')
  ),

  -- Send details
  message_content TEXT,
  platform_message_id TEXT,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'sent', 'failed')
  ),
  error_message TEXT,
  sent_at TIMESTAMPTZ,

  -- The critical constraint: only one send per agent per idempotency key
  UNIQUE(agent_id, idempotency_key)
);

-- Indexes for querying
CREATE INDEX IF NOT EXISTS idx_send_log_agent ON send_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_send_log_lead ON send_log(lead_id);
CREATE INDEX IF NOT EXISTS idx_send_log_created ON send_log(created_at DESC);

-- =============================================================================
-- 2. acquire_send_lock function
-- =============================================================================
-- Atomically attempts to INSERT a send_log record.
-- Returns the new row's UUID if the lock was acquired (first caller wins).
-- Returns NULL if the idempotency_key already exists (duplicate blocked).
CREATE OR REPLACE FUNCTION acquire_send_lock(
  p_agent_id UUID,
  p_lead_id UUID,
  p_lead_email TEXT,
  p_idempotency_key TEXT,
  p_send_source TEXT,
  p_message_content TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO send_log (agent_id, lead_id, lead_email, idempotency_key, send_source, message_content)
  VALUES (p_agent_id, p_lead_id, p_lead_email, p_idempotency_key, p_send_source, p_message_content)
  ON CONFLICT (agent_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;  -- NULL means lock was NOT acquired (duplicate)
END;
$$;
