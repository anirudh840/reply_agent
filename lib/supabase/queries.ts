import { supabaseAdmin } from './client';
import type {
  Agent,
  Reply,
  InterestedLead,
  KnowledgeBaseEmbedding,
  FeedbackLog,
  RetrievalResult,
} from '../types';
import { DatabaseError } from '../types';

// =====================================================
// AGENT QUERIES
// =====================================================

export async function createAgent(agent: Omit<Agent, 'id' | 'created_at' | 'updated_at'>) {
  // @ts-ignore - Supabase generated types issue
  const { data, error } = await supabaseAdmin.from('agents').insert(agent).select().single();

  if (error) throw new DatabaseError('Failed to create agent', error);
  return data as Agent;
}

export async function getAgent(id: string) {
  const { data, error } = await supabaseAdmin
    .from('agents')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new DatabaseError('Failed to get agent', error);
  return data as Agent;
}

export async function getAgents(activeOnly: boolean = true) {
  let query = supabaseAdmin.from('agents').select('*').order('created_at', { ascending: false });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error} = await query;

  if (error) throw new DatabaseError('Failed to get agents', error);
  return data as Agent[];
}

export async function getAllAgents() {
  return getAgents(false);
}

export async function updateAgent(id: string, updates: Partial<Agent>) {
  const { data, error } = await supabaseAdmin
    .from('agents')
    // @ts-ignore - Supabase generated types issue
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update agent', error);
  return data as Agent;
}

export async function deleteAgent(id: string) {
  const { error } = await supabaseAdmin.from('agents').delete().eq('id', id);

  if (error) throw new DatabaseError('Failed to delete agent', error);
}

// =====================================================
// REPLY QUERIES
// =====================================================

export async function createReply(reply: Omit<Reply, 'id' | 'created_at' | 'updated_at'>) {
  // @ts-ignore - Supabase generated types issue
  const { data, error } = await supabaseAdmin.from('replies').insert(reply).select().single();

  if (error) throw new DatabaseError('Failed to create reply', error);
  return data as Reply;
}

export async function getReply(id: string) {
  const { data, error } = await supabaseAdmin
    .from('replies')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new DatabaseError('Failed to get reply', error);
  return data as Reply;
}

export async function getReplies(filters?: {
  agent_id?: string;
  processing_status?: string;
  corrected_status?: string;
  is_truly_interested?: boolean;
  limit?: number;
  offset?: number;
}) {
  let query = supabaseAdmin.from('replies').select('*', { count: 'exact' });

  if (filters?.agent_id) query = query.eq('agent_id', filters.agent_id);
  if (filters?.processing_status) query = query.eq('processing_status', filters.processing_status);
  if (filters?.corrected_status) query = query.eq('corrected_status', filters.corrected_status);
  if (filters?.is_truly_interested !== undefined)
    query = query.eq('is_truly_interested', filters.is_truly_interested);

  query = query.order('received_at', { ascending: false });

  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);

  const { data, error, count } = await query;

  if (error) throw new DatabaseError('Failed to get replies', error);
  return { data: data as Reply[], count: count || 0 };
}

export async function updateReply(id: string, updates: Partial<Reply>) {
  const { data, error } = await supabaseAdmin
    .from('replies')
    // @ts-ignore - Supabase generated types issue
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update reply', error);
  return data as Reply;
}

export async function getReplyByEmailBisonId(emailbisonReplyId: string, agentId?: string) {
  let query = supabaseAdmin
    .from('replies')
    .select('*')
    .eq('emailbison_reply_id', emailbisonReplyId);

  if (agentId) {
    query = query.eq('agent_id', agentId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) throw new DatabaseError('Failed to get reply by EmailBison ID', error);
  return data as Reply | null;
}

// =====================================================
// INTERESTED LEAD QUERIES
// =====================================================

export async function createInterestedLead(
  lead: Omit<InterestedLead, 'id' | 'created_at' | 'updated_at'>
) {
  const { data, error } = await supabaseAdmin
    .from('interested_leads')
    // @ts-ignore - Supabase generated types issue
    .insert(lead)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to create interested lead', error);
  return data as InterestedLead;
}

export async function getInterestedLead(id: string) {
  const { data, error } = await supabaseAdmin
    .from('interested_leads')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new DatabaseError('Failed to get interested lead', error);
  return data as InterestedLead;
}

export async function getInterestedLeadByEmail(agentId: string, email: string) {
  const { data, error } = await supabaseAdmin
    .from('interested_leads')
    .select('*')
    .eq('agent_id', agentId)
    .eq('lead_email', email)
    .maybeSingle();

  if (error) throw new DatabaseError('Failed to get interested lead by email', error);
  return data as InterestedLead | null;
}

export async function getInterestedLeads(filters?: {
  agent_id?: string;
  agent_ids?: string[];
  conversation_status?: string;
  needs_approval?: boolean;
  date_from?: string;
  date_to?: string;
  limit?: number;
  offset?: number;
}) {
  // Select interested_leads and join with replies to get category information
  let query = supabaseAdmin
    .from('interested_leads')
    .select(`
      *,
      initial_reply:replies!initial_reply_id(
        is_truly_interested,
        is_automated_original,
        is_tracked_original,
        original_status,
        corrected_status
      )
    `, { count: 'exact' });

  // Support both single agent_id and multiple agent_ids
  if (filters?.agent_ids && filters.agent_ids.length > 0) {
    query = query.in('agent_id', filters.agent_ids);
  } else if (filters?.agent_id) {
    query = query.eq('agent_id', filters.agent_id);
  }

  if (filters?.conversation_status) query = query.eq('conversation_status', filters.conversation_status);
  if (filters?.needs_approval !== undefined)
    query = query.eq('needs_approval', filters.needs_approval);

  // Date range filters
  if (filters?.date_from) query = query.gte('created_at', filters.date_from);
  if (filters?.date_to) query = query.lte('created_at', filters.date_to);

  query = query.order('created_at', { ascending: false });

  if (filters?.limit) query = query.limit(filters.limit);
  if (filters?.offset) query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);

  const { data, error, count } = await query;

  if (error) throw new DatabaseError('Failed to get interested leads', error);

  // Flatten the initial_reply data into the lead object
  const leads = (data || []).map((lead: any) => ({
    ...lead,
    is_truly_interested: lead.initial_reply?.is_truly_interested,
    is_automated_original: lead.initial_reply?.is_automated_original,
    is_tracked_original: lead.initial_reply?.is_tracked_original,
    original_status: lead.initial_reply?.original_status,
    corrected_status: lead.initial_reply?.corrected_status,
    initial_reply: undefined, // Remove the nested object
  }));

  return { data: leads as InterestedLead[], count: count || 0 };
}

export async function updateInterestedLead(id: string, updates: Partial<InterestedLead>) {
  const { data, error } = await supabaseAdmin
    .from('interested_leads')
    // @ts-ignore - Supabase generated types issue
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update interested lead', error);
  return data as InterestedLead;
}

export async function getLeadsDueForFollowup(agentId?: string) {
  let query = supabaseAdmin
    .from('interested_leads')
    .select('*')
    .eq('conversation_status', 'active')
    .not('next_followup_due_at', 'is', null)
    .lte('next_followup_due_at', new Date().toISOString());

  if (agentId) query = query.eq('agent_id', agentId);

  const { data, error } = await query;

  if (error) throw new DatabaseError('Failed to get leads due for followup', error);
  return data as InterestedLead[];
}

// =====================================================
// KNOWLEDGE BASE EMBEDDING QUERIES
// =====================================================

export async function createEmbedding(
  embedding: Omit<KnowledgeBaseEmbedding, 'id' | 'created_at'>
) {
  const { data, error } = await supabaseAdmin
    .from('knowledge_base_embeddings')
    // @ts-ignore - Supabase generated types issue
    .insert(embedding)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to create embedding', error);
  return data as KnowledgeBaseEmbedding;
}

export async function createEmbeddings(
  embeddings: Omit<KnowledgeBaseEmbedding, 'id' | 'created_at'>[]
) {
  const { data, error } = await supabaseAdmin
    .from('knowledge_base_embeddings')
    // @ts-ignore - Supabase generated types issue
    .insert(embeddings)
    .select();

  if (error) throw new DatabaseError('Failed to create embeddings', error);
  return data as KnowledgeBaseEmbedding[];
}

export async function searchKnowledgeBase(
  queryEmbedding: number[],
  agentId: string,
  matchCount: number = 5,
  similarityThreshold: number = 0.7
): Promise<RetrievalResult[]> {
  // Skip database search for test agents
  if (agentId === 'test-agent' || agentId === 'test') {
    return [];
  }

  // @ts-ignore - Supabase generated types issue with RPC function
  const { data, error } = await supabaseAdmin.rpc('search_knowledge_base', {
    query_embedding: queryEmbedding,
    match_agent_id: agentId,
    match_count: matchCount,
    similarity_threshold: similarityThreshold,
  });

  if (error) {
    console.error('Error searching knowledge base:', error);
    return []; // Return empty array instead of throwing error
  }

  return (data as RetrievalResult[]) || [];
}

export async function deleteAgentEmbeddings(agentId: string) {
  const { error } = await supabaseAdmin
    .from('knowledge_base_embeddings')
    .delete()
    .eq('agent_id', agentId);

  if (error) throw new DatabaseError('Failed to delete agent embeddings', error);
}

// =====================================================
// FEEDBACK LOG QUERIES
// =====================================================

export async function createFeedbackLog(
  feedback: Omit<FeedbackLog, 'id' | 'created_at'>
) {
  const { data, error } = await supabaseAdmin
    .from('feedback_logs')
    // @ts-ignore - Supabase generated types issue
    .insert(feedback)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to create feedback log', error);
  return data as FeedbackLog;
}

export async function getFeedbackLogs(filters?: {
  agent_id?: string;
  feedback_type?: string;
  applied_to_knowledge_base?: boolean;
  limit?: number;
}) {
  let query = supabaseAdmin.from('feedback_logs').select('*');

  if (filters?.agent_id) query = query.eq('agent_id', filters.agent_id);
  if (filters?.feedback_type) query = query.eq('feedback_type', filters.feedback_type);
  if (filters?.applied_to_knowledge_base !== undefined)
    query = query.eq('applied_to_knowledge_base', filters.applied_to_knowledge_base);

  query = query.order('created_at', { ascending: false });

  if (filters?.limit) query = query.limit(filters.limit);

  const { data, error } = await query;

  if (error) throw new DatabaseError('Failed to get feedback logs', error);
  return data as FeedbackLog[];
}

export async function updateFeedbackLog(id: string, updates: Partial<FeedbackLog>) {
  const { data, error } = await supabaseAdmin
    .from('feedback_logs')
    // @ts-ignore - Supabase generated types issue
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new DatabaseError('Failed to update feedback log', error);
  return data as FeedbackLog;
}

// =====================================================
// DASHBOARD METRICS QUERIES
// =====================================================

export async function getDashboardMetrics(agentId?: string) {
  let repliesQuery = supabaseAdmin.from('replies').select('*', { count: 'exact', head: true });
  let interestedQuery = supabaseAdmin
    .from('replies')
    .select('*', { count: 'exact', head: true })
    .eq('is_truly_interested', true);
  let automatedQuery = supabaseAdmin
    .from('replies')
    .select('*', { count: 'exact', head: true })
    .eq('is_automated_original', true);
  let leadsQuery = supabaseAdmin
    .from('interested_leads')
    .select('*', { count: 'exact', head: true });
  let needsApprovalQuery = supabaseAdmin
    .from('interested_leads')
    .select('*', { count: 'exact', head: true })
    .eq('needs_approval', true);
  let errorsQuery = supabaseAdmin
    .from('replies')
    .select('*', { count: 'exact', head: true })
    .eq('processing_status', 'error');

  if (agentId) {
    repliesQuery = repliesQuery.eq('agent_id', agentId);
    interestedQuery = interestedQuery.eq('agent_id', agentId);
    automatedQuery = automatedQuery.eq('agent_id', agentId);
    leadsQuery = leadsQuery.eq('agent_id', agentId);
    needsApprovalQuery = needsApprovalQuery.eq('agent_id', agentId);
    errorsQuery = errorsQuery.eq('agent_id', agentId);
  }

  const [totalReplies, interestedReplies, automatedReplies, totalLeads, needsApproval, errors] =
    await Promise.all([
      repliesQuery,
      interestedQuery,
      automatedQuery,
      leadsQuery,
      needsApprovalQuery,
      errorsQuery,
    ]);

  return {
    total_replies: totalReplies.count || 0,
    interested_replies: interestedReplies.count || 0,
    automated_replies: automatedReplies.count || 0,
    needs_approval: needsApproval.count || 0,
    auto_responded: (totalLeads.count || 0) - (needsApproval.count || 0),
    errors: errors.count || 0,
    false_positives: 0, // TODO: Calculate based on feedback logs
  };
}

export async function getChartData(agentId?: string, days: number = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  let query = supabaseAdmin
    .from('replies')
    .select('received_at, is_truly_interested, is_automated_original')
    .gte('received_at', startDate.toISOString())
    .order('received_at', { ascending: true });

  if (agentId) query = query.eq('agent_id', agentId);

  const { data, error } = await query;

  if (error) throw new DatabaseError('Failed to get chart data', error);

  // Group by date
  const groupedData: Record<string, { positive: number; automated: number; total: number }> = {};

  data?.forEach((reply: any) => {
    const date = reply.received_at.split('T')[0];
    if (!groupedData[date]) {
      groupedData[date] = { positive: 0, automated: 0, total: 0 };
    }
    groupedData[date].total++;
    if (reply.is_truly_interested) groupedData[date].positive++;
    if (reply.is_automated_original) groupedData[date].automated++;
  });

  return Object.entries(groupedData).map(([date, counts]) => ({
    date,
    positive_responses: counts.positive,
    automated_responses: counts.automated,
    total_responses: counts.total,
  }));
}
