-- =====================================================
-- REPLY AGENT - SUPABASE DATABASE SCHEMA
-- =====================================================
-- Run this script in your Supabase SQL Editor
-- Project URL: https://fxxjfgfnrywffjmxoadl.supabase.co
-- =====================================================

-- Enable pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- TABLE 1: agents
-- Stores agent configurations, knowledge base, and learning patterns
-- =====================================================

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Agent Configuration
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('fully_automated', 'human_in_loop')),
  timezone TEXT NOT NULL DEFAULT 'UTC',

  -- API Credentials (will be encrypted at application level)
  emailbison_api_key TEXT NOT NULL,
  emailbison_workspace_id TEXT,
  openai_api_key TEXT NOT NULL,

  -- Knowledge Base
  knowledge_base JSONB NOT NULL DEFAULT '{}',
  objection_handling JSONB DEFAULT '{}',
  case_studies JSONB DEFAULT '[]',

  -- Follow-up Configuration
  followup_sequence JSONB NOT NULL DEFAULT '{
    "type": "default",
    "steps": [
      {"delay_days": 1, "type": "value_driven"},
      {"delay_days": 3, "type": "value_driven"},
      {"delay_days": 10, "type": "close_up"}
    ]
  }',

  -- Learning Data
  learned_patterns JSONB DEFAULT '[]',
  confidence_threshold FLOAT DEFAULT 6.0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ
);

-- Indexes for agents table
CREATE INDEX IF NOT EXISTS idx_agents_active ON agents(is_active);
CREATE INDEX IF NOT EXISTS idx_agents_created ON agents(created_at DESC);

-- =====================================================
-- TABLE 2: replies
-- Stores all email replies from EmailBison with AI categorization
-- =====================================================

CREATE TABLE IF NOT EXISTS replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Agent Reference
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

  -- EmailBison Data
  emailbison_reply_id TEXT NOT NULL,
  emailbison_campaign_id TEXT,

  -- Lead Information
  lead_email TEXT NOT NULL,
  lead_name TEXT,
  lead_company TEXT,
  lead_metadata JSONB DEFAULT '{}',

  -- Reply Content
  reply_subject TEXT,
  reply_body TEXT NOT NULL,
  reply_html TEXT,
  received_at TIMESTAMPTZ NOT NULL,

  -- Original EmailBison Status
  original_status TEXT NOT NULL,
  is_automated_original BOOLEAN,
  is_tracked_original BOOLEAN,

  -- AI-Corrected Status
  corrected_status TEXT,
  is_truly_interested BOOLEAN,
  ai_confidence_score FLOAT,
  ai_reasoning TEXT,

  -- Processing Status
  processing_status TEXT DEFAULT 'pending' CHECK (
    processing_status IN ('pending', 'processed', 'error', 'skipped')
  ),
  error_message TEXT,
  processed_at TIMESTAMPTZ
);

-- Indexes for replies table
CREATE INDEX IF NOT EXISTS idx_replies_agent ON replies(agent_id);
CREATE INDEX IF NOT EXISTS idx_replies_status ON replies(corrected_status);
CREATE INDEX IF NOT EXISTS idx_replies_processing ON replies(processing_status);
CREATE INDEX IF NOT EXISTS idx_replies_received ON replies(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_replies_emailbison_id ON replies(emailbison_reply_id);
ALTER TABLE replies ADD CONSTRAINT replies_agent_emailbison_reply_unique UNIQUE (agent_id, emailbison_reply_id);
CREATE INDEX IF NOT EXISTS idx_replies_lead_email ON replies(lead_email);
CREATE INDEX IF NOT EXISTS idx_replies_interested ON replies(is_truly_interested) WHERE is_truly_interested = true;

-- =====================================================
-- TABLE 3: interested_leads
-- Tracks interested leads with conversation history and follow-up state
-- =====================================================

CREATE TABLE IF NOT EXISTS interested_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Agent & Reply References
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  initial_reply_id UUID REFERENCES replies(id),

  -- Lead Information
  lead_email TEXT NOT NULL,
  lead_name TEXT,
  lead_company TEXT,
  lead_metadata JSONB DEFAULT '{}',

  -- Conversation Thread
  conversation_thread JSONB NOT NULL DEFAULT '[]',
  -- Structure: [
  --   {
  --     "role": "lead|agent",
  --     "content": "message",
  --     "timestamp": "ISO8601",
  --     "emailbison_message_id": "optional"
  --   }
  -- ]

  -- Response State
  last_response_generated TEXT,
  last_response_sent TEXT,
  last_response_sent_at TIMESTAMPTZ,
  response_confidence_score FLOAT,

  -- Approval Workflow
  needs_approval BOOLEAN DEFAULT false,
  approval_reason TEXT,
  approved_at TIMESTAMPTZ,

  -- Follow-up Tracking
  followup_stage INT DEFAULT 0, -- 0=initial response, 1-3=followups
  next_followup_due_at TIMESTAMPTZ,
  last_lead_reply_at TIMESTAMPTZ,

  -- Status
  conversation_status TEXT DEFAULT 'active' CHECK (
    conversation_status IN ('active', 'completed', 'paused', 'unresponsive')
  ),

  UNIQUE(agent_id, lead_email)
);

-- Indexes for interested_leads table
CREATE INDEX IF NOT EXISTS idx_interested_leads_agent ON interested_leads(agent_id);
CREATE INDEX IF NOT EXISTS idx_interested_leads_status ON interested_leads(conversation_status);
CREATE INDEX IF NOT EXISTS idx_interested_leads_approval ON interested_leads(needs_approval) WHERE needs_approval = true;
CREATE INDEX IF NOT EXISTS idx_interested_leads_followup ON interested_leads(next_followup_due_at) WHERE next_followup_due_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interested_leads_email ON interested_leads(lead_email);
CREATE INDEX IF NOT EXISTS idx_interested_leads_stage ON interested_leads(followup_stage);

-- =====================================================
-- TABLE 4: knowledge_base_embeddings
-- Stores vector embeddings for RAG retrieval
-- =====================================================

CREATE TABLE IF NOT EXISTS knowledge_base_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Agent Reference
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,

  -- Content
  content_type TEXT NOT NULL CHECK (
    content_type IN ('knowledge_base', 'objection_handling', 'case_study', 'learned_pattern')
  ),
  content_text TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',

  -- Embedding (OpenAI text-embedding-3-large = 1536 dimensions)
  embedding vector(1536),

  -- Usage Tracking
  usage_count INT DEFAULT 0,
  last_used_at TIMESTAMPTZ
);

-- Indexes for knowledge_base_embeddings table
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_agent ON knowledge_base_embeddings(agent_id);
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_type ON knowledge_base_embeddings(content_type);

-- Vector similarity search index (using ivfflat algorithm)
CREATE INDEX IF NOT EXISTS idx_kb_embeddings_vector
  ON knowledge_base_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- =====================================================
-- TABLE 5: feedback_logs
-- Tracks user corrections for continuous learning
-- =====================================================

CREATE TABLE IF NOT EXISTS feedback_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- References
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES interested_leads(id),

  -- Feedback Type
  feedback_type TEXT NOT NULL CHECK (
    feedback_type IN ('accepted', 'edited', 'rejected', 'corrected')
  ),

  -- Content
  original_response TEXT NOT NULL,
  user_edited_response TEXT,
  corrections JSONB,

  -- Analysis
  extracted_patterns JSONB,
  applied_to_knowledge_base BOOLEAN DEFAULT false
);

-- Indexes for feedback_logs table
CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback_logs(feedback_type);
CREATE INDEX IF NOT EXISTS idx_feedback_pending ON feedback_logs(applied_to_knowledge_base)
  WHERE applied_to_knowledge_base = false;
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_logs(created_at DESC);

-- =====================================================
-- FUNCTIONS & TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at columns
DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_replies_updated_at ON replies;
CREATE TRIGGER update_replies_updated_at
  BEFORE UPDATE ON replies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_interested_leads_updated_at ON interested_leads;
CREATE TRIGGER update_interested_leads_updated_at
  BEFORE UPDATE ON interested_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- HELPER FUNCTIONS FOR VECTOR SEARCH
-- =====================================================

-- Function to search for similar content using vector embeddings
CREATE OR REPLACE FUNCTION search_knowledge_base(
  query_embedding vector(1536),
  match_agent_id UUID,
  match_count INT DEFAULT 5,
  similarity_threshold FLOAT DEFAULT 0.7
)
RETURNS TABLE (
  id UUID,
  content_text TEXT,
  content_type TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kb.id,
    kb.content_text,
    kb.content_type,
    kb.metadata,
    1 - (kb.embedding <=> query_embedding) AS similarity
  FROM knowledge_base_embeddings kb
  WHERE kb.agent_id = match_agent_id
    AND 1 - (kb.embedding <=> query_embedding) > similarity_threshold
  ORDER BY kb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =====================================================
-- ROW LEVEL SECURITY (Optional - Enable if needed)
-- =====================================================

-- Uncomment below if you want to enable RLS
-- ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE interested_leads ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE knowledge_base_embeddings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE feedback_logs ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- GRANT PERMISSIONS
-- =====================================================

-- Grant necessary permissions to service role
GRANT ALL ON agents TO service_role;
GRANT ALL ON replies TO service_role;
GRANT ALL ON interested_leads TO service_role;
GRANT ALL ON knowledge_base_embeddings TO service_role;
GRANT ALL ON feedback_logs TO service_role;

-- =====================================================
-- SCHEMA CREATION COMPLETE
-- =====================================================

-- Verify tables were created
SELECT
  table_name,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
  AND table_name IN ('agents', 'replies', 'interested_leads', 'knowledge_base_embeddings', 'feedback_logs')
ORDER BY table_name;
