import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';

/**
 * GET /api/debug/emailbison
 * Debug endpoint to check EmailBison API connection and replies
 */
export async function GET(request: NextRequest) {
  try {
    const agents = await getAllAgents();
    const activeAgents = agents.filter((agent) => agent.is_active);

    if (activeAgents.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No active agents found',
      });
    }

    const results = [];

    for (const agent of activeAgents) {
      try {
        const emailbisonClient = createClientForAgent(agent);

        // Test 1: Fetch ALL replies (no status filter)
        const allRepliesResult = await emailbisonClient.getReplies({
          limit: 50,
        });

        // Test 2: Fetch only interested replies
        const interestedRepliesResult = await emailbisonClient.getReplies({
          status: 'interested',
          limit: 50,
        });

        // Test 3: Check campaigns
        const campaigns = await emailbisonClient.getCampaigns();

        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          total_replies: allRepliesResult.data.length,
          interested_replies: interestedRepliesResult.data.length,
          total_campaigns: campaigns.data.length,
          all_replies_sample: allRepliesResult.data.slice(0, 5).map((r) => ({
            id: r.id,
            from_email: r.from_email,
            from_name: r.from_name,
            status: r.status,
            is_automated: r.is_automated,
            received_at: r.received_at,
            subject: r.subject,
            body_preview: r.body.substring(0, 100),
          })),
          interested_replies_sample: interestedRepliesResult.data.slice(0, 5).map((r) => ({
            id: r.id,
            from_email: r.from_email,
            from_name: r.from_name,
            status: r.status,
            received_at: r.received_at,
          })),
        });
      } catch (agentError: any) {
        results.push({
          agent_id: agent.id,
          agent_name: agent.name,
          error: agentError.message || 'Failed to fetch from platform',
          error_details: agentError.toString(),
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    console.error('Error in debug endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to debug platform connection',
      },
      { status: 500 }
    );
  }
}
