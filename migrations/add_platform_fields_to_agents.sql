-- Migration: Add multi-platform support to agents table
-- Supports: emailbison, smartlead, instantly

-- Add platform column (defaults to 'emailbison' for backward compatibility)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'emailbison'
CHECK (platform IN ('emailbison', 'smartlead', 'instantly'));

-- Add platform_instance_url column (used by EmailBison for custom instances)
ALTER TABLE agents
ADD COLUMN IF NOT EXISTS platform_instance_url TEXT;

-- Create index on platform for filtering
CREATE INDEX IF NOT EXISTS idx_agents_platform ON agents(platform);
