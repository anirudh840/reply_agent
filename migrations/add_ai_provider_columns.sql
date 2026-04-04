-- Migration: Add AI provider, model, and Anthropic API key columns to agents table
-- Purpose: Support multiple AI providers (OpenAI + Anthropic) with per-agent model selection

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS ai_provider TEXT DEFAULT 'openai',
  ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT 'gpt-4o-mini',
  ADD COLUMN IF NOT EXISTS anthropic_api_key TEXT;
