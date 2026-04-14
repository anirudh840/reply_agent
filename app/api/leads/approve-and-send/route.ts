import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, updateInterestedLead, getAgent, createFeedbackLog } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { refreshConversationThread } from '@/lib/platforms/thread-sync';
import { acquireSendLock, markSendComplete, markSendFailed } from '@/lib/supabase/send-guard';
import { addDays } from 'date-fns';

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

    // Guard: block only terminal (booking-confirmed) sends.
    // paused/unresponsive are intentionally allowed — if the user is explicitly
    // approving a send from the inbox, they know what they're doing. The lead
    // will be flipped back to 'active' on a successful send below.
    if (lead.conversation_status === 'completed') {
      return NextResponse.json(
        { success: false, error: `Cannot send to a lead with status 'completed' (booking confirmed or sequence closed).` },
        { status: 400 }
      );
    }

    // Get agent details
    const agent = await getAgent(lead.agent_id);

    // Check if message was edited (strip HTML since TipTap sends HTML, DB stores plain text)
    const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
    const wasEdited = stripHtml(message) !== (lead.last_response_generated || '').trim();

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
    // Must find a lead message that has an emailbison_message_id (skip quoted messages without one)
    const lastLeadMessage = lead.conversation_thread
      .filter((msg) => msg.role === 'lead' && msg.emailbison_message_id)
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

    // Acquire send lock to prevent duplicate sends
    const sendLock = await acquireSendLock({
      agentId: agent.id,
      leadId: lead.id,
      leadEmail: lead.lead_email,
      idempotencyKey: `reply-to:${lastLeadMessage.emailbison_message_id}`,
      sendSource: 'approve',
      messageContent: message,
    });

    if (!sendLock.acquired) {
      return NextResponse.json(
        {
          success: false,
          error: 'A response to this lead message has already been sent',
        },
        { status: 409 }
      );
    }

    // Send reply via platform
    let sendResult;
    try {
    sendResult = await emailbisonClient.sendReply({
      replyId: lastLeadMessage.emailbison_message_id,
      message,
      cc: cc || [],
      bcc: bcc || [],
      attachments: attachments || [],
    });

    if (!sendResult.success) {
      if (sendLock.sendLogId) await markSendFailed(sendLock.sendLogId, 'Platform returned failure');
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to send email via platform',
        },
        { status: 502 }
      );
    }

    if (sendLock.sendLogId) await markSendComplete(sendLock.sendLogId, sendResult.message_id);
    } catch (sendErr: any) {
      if (sendLock.sendLogId) await markSendFailed(sendLock.sendLogId, sendErr.message || 'Unknown error');
      throw sendErr;
    }

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

    // Schedule the next followup based on the lead's current followup_stage.
    // Semantics: lead.followup_stage is the index of the most recently generated
    // step (initial response = 0; each held/sent followup advances this).
    // steps[followup_stage] holds the config for the *next* step to send. When
    // followup_stage >= steps.length the sequence is exhausted — mark completed.
    const steps = agent.followup_sequence?.steps ?? [];
    const nextFollowupConfig = steps[lead.followup_stage];
    const isFinalStage = !nextFollowupConfig;
    const nextFollowupDate = nextFollowupConfig
      ? addDays(new Date(), nextFollowupConfig.delay_days).toISOString()
      : null;

    await updateInterestedLead(lead_id, {
      conversation_thread: refreshedThread,
      last_response_sent: message,
      last_response_sent_at: now,
      needs_approval: false,
      approved_at: now,
      next_followup_due_at: nextFollowupDate,
      conversation_status: isFinalStage ? 'completed' : 'active',
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
