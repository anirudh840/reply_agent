import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, updateInterestedLead, getAgent, createFeedbackLog } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { refreshConversationThread } from '@/lib/platforms/thread-sync';

/**
 * POST /api/leads/approve-and-send
 * Approve AI-generated response and send it
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, message, cc, bcc, attachments } = body;

    if (!lead_id || !message) {
      return NextResponse.json(
        {
          success: false,
          error: 'lead_id and message are required',
        },
        { status: 400 }
      );
    }

    // Get lead details
    const lead = await getInterestedLead(lead_id);
    if (!lead) {
      return NextResponse.json(
        {
          success: false,
          error: 'Lead not found',
        },
        { status: 404 }
      );
    }

    // Get agent details
    const agent = await getAgent(lead.agent_id);

    // Check if message was edited
    const wasEdited = message !== lead.last_response_generated;

    // Log feedback for learning
    if (wasEdited) {
      await createFeedbackLog({
        agent_id: lead.agent_id,
        lead_id: lead.id,
        feedback_type: 'edited',
        original_response: lead.last_response_generated || '',
        user_edited_response: message,
        corrections: {
          confidence_score: lead.response_confidence_score,
          was_approved: true,
          edit_type: 'modified',
        },
        applied_to_knowledge_base: false,
      });
    } else {
      await createFeedbackLog({
        agent_id: lead.agent_id,
        lead_id: lead.id,
        feedback_type: 'accepted',
        original_response: lead.last_response_generated || '',
        user_edited_response: undefined,
        corrections: {
          confidence_score: lead.response_confidence_score,
          was_approved: true,
          edit_type: 'none',
        },
        applied_to_knowledge_base: false,
      });
    }

    // Create platform client
    const emailbisonClient = createClientForAgent(agent);

    // Get the most recent platform reply ID
    const lastLeadMessage = lead.conversation_thread
      .filter((msg) => msg.role === 'lead')
      .slice(-1)[0];

    if (!lastLeadMessage?.emailbison_message_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'No platform message ID found to reply to',
        },
        { status: 400 }
      );
    }

    // Send reply via platform
    const sendResult = await emailbisonClient.sendReply({
      replyId: lastLeadMessage.emailbison_message_id,
      message,
      cc: cc || [],
      bcc: bcc || [],
      attachments: attachments || [],
    });

    const now = new Date().toISOString();

    // Refresh thread from the platform API to get the complete conversation
    const refreshedThread = await refreshConversationThread({
      lead,
      agent,
      sentMessage: {
        content: message,
        timestamp: now,
        message_id: sendResult.message_id,
      },
    });

    await updateInterestedLead(lead_id, {
      conversation_thread: refreshedThread,
      last_response_sent: message,
      last_response_sent_at: now,
      needs_approval: false,
      approved_at: now,
    });

    return NextResponse.json({
      success: true,
      message: 'Response approved and sent successfully',
      was_edited: wasEdited,
    });
  } catch (error: any) {
    console.error('Error approving and sending:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to approve and send',
      },
      { status: 500 }
    );
  }
}
