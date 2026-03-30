import { NextRequest, NextResponse } from 'next/server';
import {
  getAgent,
  getInterestedLead,
  updateInterestedLead,
  createFeedbackLog,
} from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { acquireSendLock, markSendComplete, markSendFailed } from '@/lib/supabase/send-guard';
import type { ConversationMessage } from '@/lib/types';
import { addDays } from 'date-fns';

/**
 * POST /api/responses/send
 * Send an approved response
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, response_content, edited } = body;

    if (!lead_id || !response_content) {
      return NextResponse.json(
        {
          success: false,
          error: 'lead_id and response_content are required',
        },
        { status: 400 }
      );
    }

    // Get interested lead
    const lead = await getInterestedLead(lead_id);

    // Get agent
    const agent = await getAgent(lead.agent_id);

    // Create platform client
    const emailbisonClient = createClientForAgent(agent);

    // Get the last message from the lead to get the reply ID
    // Must find a lead message that has an emailbison_message_id (skip quoted messages without one)
    const lastLeadMessage = lead.conversation_thread
      .filter((msg) => msg.role === 'lead' && msg.emailbison_message_id)
      .slice(-1)[0];

    if (!lastLeadMessage?.emailbison_message_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'No platform message ID found for reply',
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
      sendSource: 'legacy_approve',
      messageContent: response_content,
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
    try {
      const sendResult = await emailbisonClient.sendReply({
        replyId: lastLeadMessage.emailbison_message_id,
        message: response_content,
      });

      if (!sendResult.success) {
        if (sendLock.sendLogId) await markSendFailed(sendLock.sendLogId, 'Platform returned failure');
        throw new Error('Failed to send email via platform');
      }

      if (sendLock.sendLogId) await markSendComplete(sendLock.sendLogId, sendResult.message_id);

      // Add agent message to conversation thread
      const agentMessage: ConversationMessage = {
        role: 'agent',
        content: response_content,
        timestamp: new Date().toISOString(),
        emailbison_message_id: sendResult.message_id,
      };

      const updatedThread = [...lead.conversation_thread, agentMessage];

      // Calculate next followup date (1 day from now for first followup)
      const followupConfig = agent.followup_sequence.steps[0];
      const nextFollowupDate = addDays(
        new Date(),
        followupConfig?.delay_days || 1
      );

      // Update lead
      await updateInterestedLead(lead.id, {
        conversation_thread: updatedThread,
        last_response_sent: response_content,
        last_response_sent_at: new Date().toISOString(),
        needs_approval: false,
        approved_at: new Date().toISOString(),
        followup_stage: 0, // Initial response sent
        next_followup_due_at: nextFollowupDate.toISOString(),
      });

      // Log feedback if response was edited
      if (edited && lead.last_response_generated !== response_content) {
        await createFeedbackLog({
          agent_id: agent.id,
          lead_id: lead.id,
          feedback_type: 'edited',
          original_response: lead.last_response_generated || '',
          user_edited_response: response_content,
          corrections: undefined,
          extracted_patterns: undefined,
          applied_to_knowledge_base: false,
        });
      } else if (!edited) {
        // Log as accepted
        await createFeedbackLog({
          agent_id: agent.id,
          lead_id: lead.id,
          feedback_type: 'accepted',
          original_response: response_content,
          user_edited_response: undefined,
          corrections: undefined,
          extracted_patterns: undefined,
          applied_to_knowledge_base: false,
        });
      }

      return NextResponse.json({
        success: true,
        data: {
          message_id: sendResult.message_id,
          next_followup_at: nextFollowupDate.toISOString(),
        },
        message: 'Response sent successfully',
      });
    } catch (emailError: any) {
      console.error('Error sending email:', emailError);
      if (sendLock.sendLogId) await markSendFailed(sendLock.sendLogId, emailError.message || 'Unknown error').catch(() => {});
      return NextResponse.json(
        {
          success: false,
          error: emailError.message || 'Failed to send email',
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error sending response:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to send response',
      },
      { status: 500 }
    );
  }
}
