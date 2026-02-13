// Supabase Database Types
// This is a simplified type definition - can be generated using Supabase CLI

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          name: string;
          mode: 'fully_automated' | 'human_in_loop';
          timezone: string;
          platform: 'emailbison' | 'smartlead' | 'instantly';
          platform_instance_url: string | null;
          emailbison_api_key: string;
          emailbison_workspace_id: string | null;
          openai_api_key: string;
          knowledge_base: Json;
          objection_handling: Json;
          case_studies: Json;
          followup_sequence: Json;
          learned_patterns: Json;
          confidence_threshold: number;
          is_active: boolean;
          last_sync_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['agents']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['agents']['Insert']>;
      };
      replies: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          agent_id: string;
          emailbison_reply_id: string;
          emailbison_campaign_id: string | null;
          lead_email: string;
          lead_name: string | null;
          lead_company: string | null;
          lead_metadata: Json;
          reply_subject: string | null;
          reply_body: string;
          reply_html: string | null;
          received_at: string;
          original_status: string;
          is_automated_original: boolean | null;
          is_tracked_original: boolean | null;
          corrected_status: string | null;
          is_truly_interested: boolean | null;
          ai_confidence_score: number | null;
          ai_reasoning: string | null;
          processing_status: 'pending' | 'processed' | 'error' | 'skipped';
          error_message: string | null;
          processed_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['replies']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['replies']['Insert']>;
      };
      interested_leads: {
        Row: {
          id: string;
          created_at: string;
          updated_at: string;
          agent_id: string;
          initial_reply_id: string | null;
          lead_email: string;
          lead_name: string | null;
          lead_company: string | null;
          lead_metadata: Json;
          conversation_thread: Json;
          last_response_generated: string | null;
          last_response_sent: string | null;
          last_response_sent_at: string | null;
          response_confidence_score: number | null;
          needs_approval: boolean;
          approval_reason: string | null;
          approved_at: string | null;
          followup_stage: number;
          next_followup_due_at: string | null;
          last_lead_reply_at: string | null;
          conversation_status: 'active' | 'completed' | 'paused' | 'unresponsive';
        };
        Insert: Omit<Database['public']['Tables']['interested_leads']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['interested_leads']['Insert']>;
      };
      knowledge_base_embeddings: {
        Row: {
          id: string;
          created_at: string;
          agent_id: string;
          content_type: 'knowledge_base' | 'objection_handling' | 'case_study' | 'learned_pattern';
          content_text: string;
          metadata: Json;
          embedding: number[];
          usage_count: number;
          last_used_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['knowledge_base_embeddings']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['knowledge_base_embeddings']['Insert']>;
      };
      feedback_logs: {
        Row: {
          id: string;
          created_at: string;
          agent_id: string;
          lead_id: string | null;
          feedback_type: 'accepted' | 'edited' | 'rejected' | 'corrected';
          original_response: string;
          user_edited_response: string | null;
          corrections: Json;
          extracted_patterns: Json;
          applied_to_knowledge_base: boolean;
        };
        Insert: Omit<Database['public']['Tables']['feedback_logs']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['feedback_logs']['Insert']>;
      };
    };
    Functions: {
      search_knowledge_base: {
        Args: {
          query_embedding: number[];
          match_agent_id: string;
          match_count?: number;
          similarity_threshold?: number;
        };
        Returns: Array<{
          id: string;
          content_text: string;
          content_type: string;
          metadata: Json;
          similarity: number;
        }>;
      };
    };
  };
}
