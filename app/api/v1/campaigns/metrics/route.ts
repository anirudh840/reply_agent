import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey, hasScope, getAgentFilter } from '@/lib/api-auth';
import { supabaseAdmin } from '@/lib/supabase/client';

interface ReplyRow {
  id: string;
  agent_id: string;
  emailbison_campaign_id: string | null;
  is_truly_interested: boolean | null;
  lead_email: string;
}

interface LeadRow {
  id: string;
  agent_id: string;
  lead_email: string;
  initial_reply_id: string | null;
  last_response_sent_at: string | null;
}

interface MeetingRow {
  id: string;
  agent_id: string;
  lead_email: string;
}

interface AgentRow {
  id: string;
  name: string;
}

/**
 * GET /api/v1/campaigns/metrics
 *
 * Returns per-campaign counts of leads that were actually responded to
 * (the "real positives" - leads classified as interested AND sent a reply).
 *
 * Query params:
 *   - agent_id: filter to a specific agent (optional)
 *   - since: ISO date, only count leads responded after this date (optional)
 *   - until: ISO date, only count leads responded before this date (optional)
 */
export async function GET(request: NextRequest) {
  const authResult = await requireApiKey(request);
  if (authResult instanceof NextResponse) return authResult;
  const { apiKey } = authResult;

  if (!hasScope(apiKey, 'read:campaigns')) {
    return NextResponse.json({ error: 'Missing scope: read:campaigns' }, { status: 403 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const agentIdParam = searchParams.get('agent_id');
    const since = searchParams.get('since');
    const until = searchParams.get('until');
    const agentFilter = getAgentFilter(apiKey);

    // Step 1: Get all replies
    let repliesQuery = supabaseAdmin
      .from('replies')
      .select('id, agent_id, emailbison_campaign_id, is_truly_interested, lead_email');

    if (agentIdParam) {
      repliesQuery = repliesQuery.eq('agent_id', agentIdParam);
    } else if (agentFilter) {
      repliesQuery = repliesQuery.in('agent_id', agentFilter);
    }

    if (since) repliesQuery = repliesQuery.gte('received_at', since);
    if (until) repliesQuery = repliesQuery.lte('received_at', until);

    const { data: repliesRaw, error: repliesError } = await repliesQuery;
    if (repliesError) throw repliesError;
    const replies = (repliesRaw || []) as unknown as ReplyRow[];

    // Step 2: Get interested leads that were actually responded to
    let leadsQuery = supabaseAdmin
      .from('interested_leads')
      .select('id, agent_id, lead_email, initial_reply_id, last_response_sent_at')
      .not('last_response_sent', 'is', null);

    if (agentIdParam) {
      leadsQuery = leadsQuery.eq('agent_id', agentIdParam);
    } else if (agentFilter) {
      leadsQuery = leadsQuery.in('agent_id', agentFilter);
    }

    if (since) leadsQuery = leadsQuery.gte('last_response_sent_at', since);
    if (until) leadsQuery = leadsQuery.lte('last_response_sent_at', until);

    const { data: leadsRaw, error: leadsError } = await leadsQuery;
    if (leadsError) throw leadsError;
    const respondedLeads = (leadsRaw || []) as unknown as LeadRow[];

    // Step 3: Get meetings booked
    let meetingsQuery = supabaseAdmin
      .from('meetings_booked')
      .select('id, agent_id, lead_email');

    if (agentIdParam) {
      meetingsQuery = meetingsQuery.eq('agent_id', agentIdParam);
    } else if (agentFilter) {
      meetingsQuery = meetingsQuery.in('agent_id', agentFilter);
    }

    if (since) meetingsQuery = meetingsQuery.gte('booked_at', since);
    if (until) meetingsQuery = meetingsQuery.lte('booked_at', until);

    const { data: meetingsRaw, error: meetingsError } = await meetingsQuery;
    if (meetingsError) throw meetingsError;
    const meetings = (meetingsRaw || []) as unknown as MeetingRow[];

    // Step 4: Get agent names
    const agentIds = [...new Set(replies.map(r => r.agent_id))];
    const { data: agentsRaw } = await supabaseAdmin
      .from('agents')
      .select('id, name')
      .in('id', agentIds.length ? agentIds : ['__none__']);

    const agents = (agentsRaw || []) as unknown as AgentRow[];
    const agentNameMap = new Map(agents.map(a => [a.id, a.name]));

    // Step 5: Build reply-to-campaign map for responded leads
    const replyIdToCampaign = new Map(
      replies.map(r => [r.id, r.emailbison_campaign_id])
    );

    // Step 6: Aggregate by campaign
    const campaignMap = new Map<string, {
      campaign_id: string;
      agent_id: string;
      agent_name: string;
      total_replies: number;
      interested_count: number;
      responded_count: number;
      meetings_booked: number;
    }>();

    const getCampaignKey = (campaignId: string, agentId: string) => `${campaignId}::${agentId}`;

    for (const reply of replies) {
      const campaignId = reply.emailbison_campaign_id || 'unknown';
      const key = getCampaignKey(campaignId, reply.agent_id);
      if (!campaignMap.has(key)) {
        campaignMap.set(key, {
          campaign_id: campaignId,
          agent_id: reply.agent_id,
          agent_name: agentNameMap.get(reply.agent_id) || 'Unknown',
          total_replies: 0,
          interested_count: 0,
          responded_count: 0,
          meetings_booked: 0,
        });
      }
      const entry = campaignMap.get(key)!;
      entry.total_replies++;
      if (reply.is_truly_interested) entry.interested_count++;
    }

    for (const lead of respondedLeads) {
      const campaignId = lead.initial_reply_id
        ? replyIdToCampaign.get(lead.initial_reply_id) || 'unknown'
        : 'unknown';
      const key = getCampaignKey(campaignId, lead.agent_id);
      if (!campaignMap.has(key)) {
        campaignMap.set(key, {
          campaign_id: campaignId,
          agent_id: lead.agent_id,
          agent_name: agentNameMap.get(lead.agent_id) || 'Unknown',
          total_replies: 0,
          interested_count: 0,
          responded_count: 0,
          meetings_booked: 0,
        });
      }
      campaignMap.get(key)!.responded_count++;
    }

    // Count meetings per campaign
    const leadEmailToReply = new Map(
      replies.map(r => [`${r.agent_id}::${r.lead_email}`, r.emailbison_campaign_id])
    );

    for (const meeting of meetings) {
      const campaignId = leadEmailToReply.get(`${meeting.agent_id}::${meeting.lead_email}`) || 'unknown';
      const key = getCampaignKey(campaignId, meeting.agent_id);
      if (campaignMap.has(key)) {
        campaignMap.get(key)!.meetings_booked++;
      }
    }

    const campaigns = Array.from(campaignMap.values()).sort(
      (a, b) => b.responded_count - a.responded_count
    );

    const totals = campaigns.reduce(
      (acc, c) => ({
        total_replies: acc.total_replies + c.total_replies,
        interested_count: acc.interested_count + c.interested_count,
        responded_count: acc.responded_count + c.responded_count,
        meetings_booked: acc.meetings_booked + c.meetings_booked,
      }),
      { total_replies: 0, interested_count: 0, responded_count: 0, meetings_booked: 0 }
    );

    return NextResponse.json({ campaigns, totals });
  } catch (err: any) {
    console.error('Campaign metrics error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
