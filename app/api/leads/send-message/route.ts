import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLead, updateInterestedLead, getAgent } from '@/lib/supabase/queries';
import { createEmailBisonClient } from '@/lib/emailbison/client';

/**
 * POST /api/leads/send-message
 * Send a message to a lead
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

    // Create EmailBison client
    const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);

    // Get the most recent EmailBison reply ID from conversation thread
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
        role: 'agent' as const,
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
