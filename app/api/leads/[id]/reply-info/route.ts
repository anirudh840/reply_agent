import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, getReply } from '@/lib/supabase/queries';

/**
 * GET /api/leads/[id]/reply-info
 * Get the associated Reply information for a lead (for status categorization)
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const leadId = params.id;

    // Get the interested lead
    const lead = await getInterestedLead(leadId);

    if (!lead) {
      return NextResponse.json(
        {
          success: false,
          error: 'Lead not found',
        },
        { status: 404 }
      );
    }

    // Get the associated reply if it exists
    let replyInfo = null;
    if (lead.initial_reply_id) {
      try {
        const reply = await getReply(lead.initial_reply_id);
        replyInfo = {
          corrected_status: reply.corrected_status,
          is_truly_interested: reply.is_truly_interested,
          ai_confidence_score: reply.ai_confidence_score,
          ai_reasoning: reply.ai_reasoning,
          original_status: reply.original_status,
          is_automated_original: reply.is_automated_original,
          is_tracked_original: reply.is_tracked_original,
        };
      } catch (error) {
        // Reply might not exist, that's okay
        console.log('No reply found for lead:', leadId);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        lead_id: leadId,
        reply_info: replyInfo,
      },
    });
  } catch (error: any) {
    console.error('Error fetching reply info:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch reply info',
      },
      { status: 500 }
    );
  }
}
