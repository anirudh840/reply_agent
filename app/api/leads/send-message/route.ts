import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, updateInterestedLead, getAgent } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { refreshConversationThread } from '@/lib/platforms/thread-sync';
import { acquireSendLock, markSendComplete, markSendFailed } from '@/lib/supabase/send-guard';
import { addDays } from 'date-fns';

/**
 * POST /api/leads/send-message
 * Send a message to a lead
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

    // Guard: block only terminal (booking-confirmed) sends. Any non-completed
    // status is allowed — the send will reactivate the conversation below.
    if (lead.conversation_status === 'completed') {
      return NextResponse.json(
        { success: false, error: `Cannot send to a lead with status 'completed' (booking confirmed or sequence closed).` },
        { status: 400 }
      );
    }

    // Get agent details
    const agent = await getAgent(lead.agent_id);

    // Create platform client
    const emailbisonClient = createClientForAgent(agent);

    // Get the most recent platform reply ID from conversation thread
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

    // Acquire send lock (keyed to the specific lead message being replied to,
    // so only one reply per lead message is allowed regardless of timing)
    const sendLock = await acquireSendLock({
      agentId: agent.id,
      leadId: lead.id,
      leadEmail: lead.lead_email,
      idempotencyKey: `manual-reply-to:${lastLeadMessage.emailbison_message_id}`,
      sendSource: 'manual',
      messageContent: message,
    });

    if (!sendLock.acquired) {
      return NextResponse.json(
        {
          success: false,
          error: 'Duplicate send detected, please wait a moment and try again',
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
    // See approve-and-send/route.ts for semantics: lead.followup_stage is the
    // index of the most recently generated step; steps[followup_stage] is the
    // next step to send. Undefined means the sequence is exhausted.
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
      next_followup_due_at: nextFollowupDate,
      conversation_status: isFinalStage ? 'completed' : 'active',
    });

    return NextResponse.json({
      success: true,
      message: 'Message sent successfully',
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to send message',
      },
      { status: 500 }
    );
  }
}
