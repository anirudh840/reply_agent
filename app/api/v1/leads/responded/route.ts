import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey, hasScope, getAgentFilter } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase/client';

/**
 * GET /api/v1/leads/responded
 *
 * Returns leads that were actually responded to (real positives).
 * These are interested_leads where last_response_sent IS NOT NULL.
 *
 * Query params:
 *   - agent_id: filter to a specific agent (optional)
 *   - campaign_id: filter to a specific campaign (optional)
 *   - since: ISO date, responded after this date (optional)
 *   - until: ISO date, responded before this date (optional)
 *   - status: conversation_status filter (optional: active|completed|paused|unresponsive)
 *   - page: page number, default 1
 *   - per_page: items per page, default 50, max 200
 *
 * Response:
 * {
 *   data: [
 *     {
 *       id, lead_email, lead_name, lead_company,
 *       campaign_id, agent_id, agent_name,
 *       first_responded_at, last_response_sent_at,
 *       conversation_status, followup_stage,
 *       meetings_booked,
 *       reply_body (original lead reply),
 *       response_sent (what was sent back)
 *     }
 *   ],
 *   total, page, per_page, total_pages
 * }
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiKey(request);
  if (authResult instanceof NextResponse) return authResult;
  const { apiKey } = authResult;

  if (!hasScope(apiKey, 'read:leads')) {
    return NextResponse.json({ error: 'Missing scope: read:leads' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentIdParam = searchParams.get('agent_id');
    const campaignId = searchParams.get('campaign_id');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const status = searchParams.get('status');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const perPage = Math.min(200, Math.max(1, parseInt(searchParams.get('per_page') || '50')));
    const agentFilter = getAgentFilter(apiKey);

    // Build query for interested leads that were responded to
    let query = supabaseAdmin
      .from('interested_leads')
      .select('*, replies!inner(emailbison_campaign_id, reply_body, reply_subject)', { count: 'exact' })
      .not('last_response_sent', 'is', null);

    // Apply filters
    if (agentIdParam) {
      query = query.eq('agent_id', agentIdParam);
    } else if (agentFilter) {
      query = query.in('agent_id', agentFilter);
    }

    if (since) query = query.gte('last_response_sent_at', since);
    if (until) query = query.lte('last_response_sent_at', until);
    if (status) query = query.eq('conversation_status', status);

    // If campaign filter, we need to filter via the joined reply
    if (campaignId) {
      query = query.eq('replies.emailbison_campaign_id', campaignId);
    }

    // Pagination
    const from = (page - 1) * perPage;
    query = query
      .order('last_response_sent_at', { ascending: false })
      .range(from, from + perPage - 1);

    const { data: leads, count, error } = await query;
    if (error) throw error;

    // Get agent names
    const agentIds = [...new Set((leads || []).map((l: any) => l.agent_id))];
    const { data: agents } = await supabaseAdmin
      .from('agents')
      .select('id, name')
      .in('id', agentIds.length ? agentIds : ['__none__']);

    const agentNameMap = new Map((agents || []).map((a: any) => [a.id, a.name]));

    // Get meetings for these leads
    const leadIds = (leads || []).map((l: any) => l.id);
    const { data: meetings } = await supabaseAdmin
      .from('meetings_booked')
      .select('lead_id')
      .in('lead_id', leadIds.length ? leadIds : ['__none__']);

    const leadsWithMeetings = new Set((meetings || []).map((m: any) => m.lead_id));

    // Format response
    const formattedLeads = (leads || []).map((lead: any) => {
      const reply = lead.replies;
      return {
        id: lead.id,
        lead_email: lead.lead_email,
        lead_name: lead.lead_name,
        lead_company: lead.lead_company,
        campaign_id: reply?.emailbison_campaign_id || null,
        agent_id: lead.agent_id,
        agent_name: agentNameMap.get(lead.agent_id) || 'Unknown',
        first_responded_at: lead.created_at,
        last_response_sent_at: lead.last_response_sent_at,
        conversation_status: lead.conversation_status,
        followup_stage: lead.followup_stage,
        has_meeting_booked: leadsWithMeetings.has(lead.id),
        original_reply_subject: reply?.reply_subject || null,
        original_reply_body: reply?.reply_body || null,
        response_sent: lead.last_response_sent,
      };
    });

    const total = count || 0;

    return NextResponse.json({
      data: formattedLeads,
      total,
      page,
      per_page: perPage,
      total_pages: Math.ceil(total / perPage),
    });
  } catch (err: any) {
    console.error('Responded leads error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
