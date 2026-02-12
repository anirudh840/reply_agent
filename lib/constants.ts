// =====================================================
// APPLICATION CONSTANTS
// =====================================================

// EmailBison Configuration
export const EMAILBISON_INSTANCE = process.env.EMAILBISON_INSTANCE || 'mail.revgenlabs.com';
export const EMAILBISON_BASE_URL = `https://${EMAILBISON_INSTANCE}/api`;

// OpenAI Configuration
export const OPENAI_MODELS = {
  GENERATION: 'gpt-4o-mini',
  EMBEDDING: 'text-embedding-3-large',
  EMBEDDING_DIMENSIONS: 1536,
} as const;

// Confidence Thresholds
export const CONFIDENCE_THRESHOLDS = {
  AUTO_SEND: 6.0,
  MIN_SCORE: 0,
  MAX_SCORE: 10,
} as const;

// Follow-up Delays (in days)
export const DEFAULT_FOLLOWUP_SEQUENCE = {
  FIRST_FOLLOWUP: 1,
  SECOND_FOLLOWUP: 3,
  THIRD_FOLLOWUP: 10,
} as const;

// Processing Status
export const PROCESSING_STATUS = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  ERROR: 'error',
  SKIPPED: 'skipped',
} as const;

// Reply Statuses
export const REPLY_STATUS = {
  INTERESTED: 'interested',
  NOT_INTERESTED: 'not_interested',
  AUTOMATED_REPLY: 'automated_reply',
  OUT_OF_OFFICE: 'out_of_office',
  UNSUBSCRIBED: 'unsubscribed',
  OTHER: 'other',
} as const;

// Conversation Statuses
export const CONVERSATION_STATUS = {
  ACTIVE: 'active',
  COMPLETED: 'completed',
  PAUSED: 'paused',
  UNRESPONSIVE: 'unresponsive',
} as const;

// Feedback Types
export const FEEDBACK_TYPE = {
  ACCEPTED: 'accepted',
  EDITED: 'edited',
  REJECTED: 'rejected',
  CORRECTED: 'corrected',
} as const;

// Content Types for Embeddings
export const CONTENT_TYPE = {
  KNOWLEDGE_BASE: 'knowledge_base',
  OBJECTION_HANDLING: 'objection_handling',
  CASE_STUDY: 'case_study',
  LEARNED_PATTERN: 'learned_pattern',
} as const;

// Pagination Defaults
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const;

// RAG Configuration
export const RAG_CONFIG = {
  TOP_K_RESULTS: 5,
  SIMILARITY_THRESHOLD: 0.7,
  CHUNK_SIZE: 512,
} as const;

// Rate Limiting
export const RATE_LIMITS = {
  MAX_RETRIES: 3,
  INITIAL_BACKOFF_MS: 1000,
  MAX_BACKOFF_MS: 30000,
} as const;

// Error Messages
export const ERROR_MESSAGES = {
  INVALID_API_KEY: 'Invalid API key provided',
  RATE_LIMITED: 'Rate limit exceeded. Please try again later',
  NETWORK_ERROR: 'Network error occurred. Please check your connection',
  PROCESSING_ERROR: 'Error processing request',
  NOT_FOUND: 'Resource not found',
  UNAUTHORIZED: 'Unauthorized access',
  VALIDATION_ERROR: 'Validation error',
} as const;

// Success Messages
export const SUCCESS_MESSAGES = {
  AGENT_CREATED: 'Agent created successfully',
  AGENT_UPDATED: 'Agent updated successfully',
  AGENT_DELETED: 'Agent deleted successfully',
  RESPONSE_SENT: 'Response sent successfully',
  RESPONSE_APPROVED: 'Response approved and sent',
  KNOWLEDGE_BASE_UPDATED: 'Knowledge base updated successfully',
} as const;

// Timezone List (common ones)
export const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const;

// Agent Modes
export const AGENT_MODES = {
  FULLY_AUTOMATED: 'fully_automated',
  HUMAN_IN_LOOP: 'human_in_loop',
} as const;

// Follow-up Types
export const FOLLOWUP_TYPES = {
  VALUE_DRIVEN: 'value_driven',
  CLOSE_UP: 'close_up',
  CUSTOM: 'custom',
} as const;
