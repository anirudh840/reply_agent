import { NextRequest, NextResponse } from 'next/server';
import {
  getAgent,
  getReply,
  getInterestedLeadByEmail,
  createInterestedLead,
  updateInterestedLead,
} from '@/lib/supabase/queries';
import { generateResponse } from '@/lib/openai/generator';
import { createEmailBisonClient } from '@/lib/emailbison/client';
import type { ConversationMessage } from '@/lib/types';
import { CONFIDENCE_THRESHOLDS } from '@/lib/constants';

/**
 * POST /api/responses/generate
 * Generate AI response for a reply
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reply_id } = body;

    if (!reply_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'reply_id is required',
        },
        { status: 400 }
      );
    }

    // Get reply
    const reply = await getReply(reply_id);

    if (!reply.is_truly_interested) {
      return NextResponse.json(
        {
          success: false,
          error: 'Reply is not marked as truly interested',
        },
        { status: 400 }
      );
    }

    // Get agent
    const agent = await getAgent(reply.agent_id);

    // Check if lead already exists
    let interestedLead = await getInterestedLeadByEmail(
      agent.id,
      reply.lead_email
    );

    // Build conversation history
    const conversationHistory: ConversationMessage[] = interestedLead
      ? interestedLead.conversation_thread
      : [];

    // Add the new lead message to history
    const newLeadMessage: ConversationMessage = {
      role: 'lead',
      content: reply.reply_body,
      timestamp: reply.received_at,
      emailbison_message_id: reply.emailbison_reply_id,
    };

    conversationHistory.push(newLeadMessage);

    // Generate response
    const generatedResponse = await generateResponse({
      leadEmail: reply.lead_email,
      leadName: reply.lead_name,
      leadMessage: reply.reply_body,
      agent,
      conversationHistory,
    });

    // Determine if approval is needed
    const needsApproval =
      agent.mode === 'human_in_loop' ||
      generatedResponse.confidence_score <= agent.confidence_threshold;

    // Create or update interested lead
    if (!interestedLead) {
      // Create new interested lead
      interestedLead = await createInterestedLead({
        agent_id: agent.id,
        initial_reply_id: reply.id,
        lead_email: reply.lead_email,
        lead_name: reply.lead_name,
        lead_company: reply.lead_company,
        lead_metadata: reply.lead_metadata,
        conversation_thread: conversationHistory,
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        needs_approval: needsApproval,
        approval_reason: needsApproval ? generatedResponse.reasoning : undefined,
        followup_stage: 0,
        last_lead_reply_at: reply.received_at,
        conversation_status: 'active',
      });
    } else {
      // Update existing lead
      interestedLead = await updateInterestedLead(interestedLead.id, {
        conversation_thread: conversationHistory,
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        needs_approval: needsApproval,
        approval_reason: needsApproval ? generatedResponse.reasoning : undefined,
        last_lead_reply_at: reply.received_at,
      });
    }

    let autoSendResult: { sent: boolean; error?: string } = { sent: false };

    // Auto-send if eligible (fully automated + high confidence)
    if (!needsApproval && agent.mode === 'fully_automated') {
      try {
        const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);

        const sendResult = await emailbisonClient.sendReply({
          replyId: reply.emailbison_reply_id,
          message: generatedResponse.content,
        });

        // Update lead record with sent status
        const updatedThread: ConversationMessage[] = [
          ...interestedLead.conversation_thread,
          {
            role: 'agent',
            content: generatedResponse.content,
            timestamp: new Date().toISOString(),
            emailbison_message_id: sendResult.message_id,
          },
        ];

        await updateInterestedLead(interestedLead.id, {
          conversation_thread: updatedThread,
          last_response_sent: generatedResponse.content,
          last_response_sent_at: new Date().toISOString(),
          needs_approval: false,
        });

        autoSendResult = { sent: true };
        console.log(`Auto-sent response to ${reply.lead_email} via generate endpoint`);
      } catch (sendError: any) {
        console.error('Error auto-sending reply:', sendError);
        autoSendResult = {
          sent: false,
          error: sendError.message || 'Failed to auto-send',
        };
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        lead_id: interestedLead.id,
        response: generatedResponse.content,
        confidence_score: generatedResponse.confidence_score,
        needs_approval: needsApproval,
        reasoning: generatedResponse.reasoning,
        auto_send_eligible: !needsApproval && agent.mode === 'fully_automated',
        auto_sent: autoSendResult.sent,
        auto_send_error: autoSendResult.error,
      },
      message: autoSendResult.sent
        ? 'Response generated and auto-sent successfully'
        : 'Response generated successfully',
    });
  } catch (error: any) {
    console.error('Error generating response:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to generate response',
      },
      { status: 500 }
    );
  }
}
