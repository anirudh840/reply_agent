import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, updateInterestedLead, getAgent, createFeedbackLog } from '@/lib/supabase/queries';
import { createEmailBisonClient } from '@/lib/emailbison/client';

/**
 * POST /api/leads/approve-and-send
 * Approve AI-generated response and send it
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, message } = body;

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
      });
    } else {
      await createFeedbackLog({
        agent_id: lead.agent_id,
        lead_id: lead.id,
        feedback_type: 'accepted',
        original_response: lead.last_response_generated || '',
        user_edited_response: null,
        corrections: {
          confidence_score: lead.response_confidence_score,
          was_approved: true,
          edit_type: 'none',
        },
      });
    }

    // Create EmailBison client
    const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);

    // Get the most recent EmailBison reply ID
    const lastLeadMessage = lead.conversation_thread
      .filter((msg) => msg.role === 'lead')
      .slice(-1)[0];

    if (!lastLeadMessage?.emailbison_message_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'No EmailBison message ID found to reply to',
        },
        { status: 400 }
      );
    }

    // Send reply via EmailBison
    const sendResult = await emailbisonClient.sendReply({
      replyId: lastLeadMessage.emailbison_message_id,
      message,
    });

    // Update lead record
    const updatedThread = [
      ...lead.conversation_thread,
      {
        role: 'agent',
        content: message,
        timestamp: new Date().toISOString(),
        emailbison_message_id: sendResult.message_id,
      },
    ];

    await updateInterestedLead(lead_id, {
      conversation_thread: updatedThread,
      last_response_sent: message,
      last_response_sent_at: new Date().toISOString(),
      needs_approval: false,
      approved_at: new Date().toISOString(),
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
