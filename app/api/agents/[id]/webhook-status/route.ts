import { NextRequest, NextResponse } from 'next/server';
import { getAgent, getReplies } from '@/lib/supabase/queries';
import { getWebhookUrl } from '@/lib/webhooks';

/**
 * GET /api/agents/[id]/webhook-status
 * Poll endpoint to check if any webhook data has been received for this agent.
 * Used by the frontend as a continuous listener.
 *
 * Query params:
 *   - since: ISO timestamp to check for replies received after this time
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const since = searchParams.get('since');

    const agent = await getAgent(id);

    if (!agent.webhook_id) {
      return NextResponse.json({
        success: false,
        error: 'Agent does not have a webhook configured',
      }, { status: 400 });
    }

    // Check for any replies received by this agent
    const { data: replies, count } = await getReplies({
      agent_id: id,
      limit: 5,
    });

    // Filter for replies received after the 'since' timestamp
    let recentReplies = replies;
    if (since) {
      const sinceDate = new Date(since);
      recentReplies = replies.filter(
        (r) => new Date(r.created_at) > sinceDate
      );
    }

    const webhookUrl = getWebhookUrl(agent.webhook_id);

    return NextResponse.json({
      success: true,
      data: {
        webhook_url: webhookUrl,
        webhook_id: agent.webhook_id,
        agent_active: agent.is_active,
        total_replies: count,
        recent_replies: recentReplies.length,
        has_received_data: recentReplies.length > 0,
        latest_reply: recentReplies.length > 0
          ? {
              id: recentReplies[0].id,
              lead_email: recentReplies[0].lead_email,
              subject: recentReplies[0].reply_subject,
              received_at: recentReplies[0].received_at,
              created_at: recentReplies[0].created_at,
              status: recentReplies[0].corrected_status,
            }
          : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to check webhook status',
    }, { status: 500 });
  }
}
