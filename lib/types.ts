// =====================================================
// TYPE DEFINITIONS FOR REPLY AGENT
// =====================================================

// Agent Types
export type AgentMode = 'fully_automated' | 'human_in_loop';

export interface Agent {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  mode: AgentMode;
  timezone: string;
  emailbison_api_key: string;
  emailbison_workspace_id?: string;
  openai_api_key: string;
  knowledge_base: KnowledgeBase;
  objection_handling: Record<string, string>;
  case_studies: CaseStudy[];
  followup_sequence: FollowupSequence;
  learned_patterns: LearnedPattern[];
  confidence_threshold: number;
  is_active: boolean;
  last_sync_at?: string;
  webhook_id?: string; // Unique ID for this agent's webhook URL
  webhook_secret?: string; // Secret for webhook verification (optional)
}

export interface KnowledgeBase {
  company_info?: string;
  product_description?: string;
  value_propositions?: string[];
  target_audience?: string;
  common_questions?: Array<{ question: string; answer: string }>;
  custom_instructions?: string;
}

export interface CaseStudy {
  title: string;
  description: string;
  results: string;
  relevant_for?: string[];
}

export interface FollowupSequence {
  type: 'default' | 'custom';
  steps: FollowupStep[];
}

export interface FollowupStep {
  delay_days: number;
  type: 'value_driven' | 'close_up' | 'custom';
  custom_instructions?: string;
}

export interface LearnedPattern {
  pattern_type: string;
  description: string;
  examples: string[];
  created_at: string;
}

// Reply Types
export type ProcessingStatus = 'pending' | 'processed' | 'error' | 'skipped';
export type ReplyStatus =
  | 'interested'
  | 'not_interested'
  | 'automated_reply'
  | 'out_of_office'
  | 'unsubscribed'
  | 'other';

export interface Reply {
  id: string;
  created_at: string;
  updated_at: string;
  agent_id: string;
  emailbison_reply_id: string;
  emailbison_campaign_id?: string;
  lead_email: string;
  lead_name?: string;
  lead_company?: string;
  lead_metadata: Record<string, any>;
  reply_subject?: string;
  reply_body: string;
  reply_html?: string;
  received_at: string;
  original_status: string;
  is_automated_original?: boolean;
  is_tracked_original?: boolean;
  corrected_status?: ReplyStatus;
  is_truly_interested?: boolean;
  ai_confidence_score?: number;
  ai_reasoning?: string;
  processing_status: ProcessingStatus;
  error_message?: string;
  processed_at?: string;
}

// Interested Lead Types
export type ConversationStatus = 'active' | 'completed' | 'paused' | 'unresponsive';
export type MessageRole = 'lead' | 'agent';

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: string;
  emailbison_message_id?: string;
}

export interface InterestedLead {
  id: string;
  created_at: string;
  updated_at: string;
  agent_id: string;
  initial_reply_id?: string;
  lead_email: string;
  lead_name?: string;
  lead_company?: string;
  lead_metadata: Record<string, any>;
  conversation_thread: ConversationMessage[];
  last_response_generated?: string;
  last_response_sent?: string;
  last_response_sent_at?: string;
  response_confidence_score?: number;
  needs_approval: boolean;
  approval_reason?: string;
  approved_at?: string;
  followup_stage: number;
  next_followup_due_at?: string;
  last_lead_reply_at?: string;
  conversation_status: ConversationStatus;
  // Category fields from initial reply
  is_truly_interested?: boolean;
  is_automated_original?: boolean;
  is_tracked_original?: boolean;
  original_status?: string;
  corrected_status?: ReplyStatus;
}

// Knowledge Base Embedding Types
export type ContentType =
  | 'knowledge_base'
  | 'objection_handling'
  | 'case_study'
  | 'learned_pattern';

export interface KnowledgeBaseEmbedding {
  id: string;
  created_at: string;
  agent_id: string;
  content_type: ContentType;
  content_text: string;
  metadata: Record<string, any>;
  embedding: number[];
  usage_count: number;
  last_used_at?: string;
}

// Feedback Types
export type FeedbackType = 'accepted' | 'edited' | 'rejected' | 'corrected';

export interface FeedbackLog {
  id: string;
  created_at: string;
  agent_id: string;
  lead_id?: string;
  feedback_type: FeedbackType;
  original_response: string;
  user_edited_response?: string;
  corrections?: Record<string, any>;
  extracted_patterns?: Record<string, any>;
  applied_to_knowledge_base: boolean;
}

// EmailBison API Types
export interface EmailBisonReply {
  id: string;
  campaign_id?: string;
  from_email: string;
  from_name?: string;
  subject?: string;
  body: string;
  html?: string;
  received_at: string;
  status: string;
  is_automated?: boolean;
  is_tracked?: boolean;
  lead_data?: Record<string, any>;
}

export interface EmailBisonSendRequest {
  reply_id: string;
  message: string;
  subject?: string;
}

export interface EmailBisonCampaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

// OpenAI Types
export interface CategorizationResult {
  is_truly_interested: boolean;
  corrected_status: ReplyStatus;
  confidence_score: number;
  reasoning: string;
}

export interface GeneratedResponse {
  content: string;
  confidence_score: number;
  retrieved_context: string[];
  reasoning: string;
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

// RAG Types
export interface RetrievalResult {
  id: string;
  content_text: string;
  content_type: ContentType;
  metadata: Record<string, any>;
  similarity: number;
}

// Dashboard Metrics Types
export interface DashboardMetrics {
  total_replies: number;
  interested_replies: number;
  automated_replies: number;
  needs_approval: number;
  auto_responded: number;
  errors: number;
  false_positives: number;
}

export interface ChartDataPoint {
  date: string;
  positive_responses: number;
  automated_responses: number;
  total_responses: number;
}

// Filter Types
export interface InboxFilters {
  lead_status?: ReplyStatus[];
  agent_status?: ('needs_approval' | 'ai_responded' | 'error')[];
  agent_ids?: string[];
  date_from?: string;
  date_to?: string;
  search?: string;
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = any> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// Agent Creation Wizard Types
export interface AgentWizardStep1 {
  mode: AgentMode;
}

export interface AgentWizardStep2 {
  emailbison_api_key: string;
  openai_api_key: string;
}

export interface AgentWizardStep3 {
  knowledge_base: KnowledgeBase;
  objection_handling: Record<string, string>;
  case_studies: CaseStudy[];
  timezone: string;
}

export interface AgentWizardStep4 {
  followup_sequence: FollowupSequence;
}

export interface AgentWizardStep5 {
  sample_responses: Array<{
    reply: EmailBisonReply;
    generated_response: string;
    user_edited_response?: string;
  }>;
}

// Error Types
export class EmailBisonError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'EmailBisonError';
  }
}

export class OpenAIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'OpenAIError';
  }
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    public originalError?: any
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}
