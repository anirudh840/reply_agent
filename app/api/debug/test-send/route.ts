import { NextRequest, NextResponse } from 'next/server';
import { getAgent, getInterestedLeads, getReply, getAllAgents } from '@/lib/supabase/queries';
import { createEmailBisonClient } from '@/lib/emailbison/client';

/**
 * GET /api/debug/test-send
 * Test sending a single reply and log full error details
 */
export async function GET(request: NextRequest) {
  try {
    // Get Test Kim agent
    const { searchParams } = new URL(request.url);
    const agentName = searchParams.get('agent') || 'Test Kim';

    const agents = await getAllAgents();
    const agent = agents.find((a) =>
      a.name.toLowerCase().includes(agentName.toLowerCase())
    );

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    // Get one pending lead
    const { data: leads } = await getInterestedLeads({
      agent_ids: [agent.id],
    });

    const pendingLead = leads.find(
      (lead) =>
        lead.last_response_generated &&
        !lead.last_response_sent &&
        !lead.needs_approval
    );

    if (!pendingLead) {
      return NextResponse.json({
        error: 'No pending leads found',
      });
    }

    if (!pendingLead.initial_reply_id) {
      return NextResponse.json({
        error: 'Lead has no initial_reply_id',
      });
    }

    const reply = await getReply(pendingLead.initial_reply_id);

    // Prepare request details
    const requestDetails = {
      agent: {
        id: agent.id,
        name: agent.name,
        emailbison_api_key: agent.emailbison_api_key.substring(0, 10) + '...',
      },
      lead: {
        id: pendingLead.id,
        email: pendingLead.lead_email,
        name: pendingLead.lead_name,
      },
      reply: {
        id: reply.id,
        emailbison_reply_id: reply.emailbison_reply_id,
      },
      sendRequest: {
        replyId: reply.emailbison_reply_id,
        message: pendingLead.last_response_generated?.substring(0, 200) + '...',
      },
    };

    // Try to send
    try {
      const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);

      const sendResult = await emailbisonClient.sendReply({
        replyId: reply.emailbison_reply_id,
        message: pendingLead.last_response_generated!,
      });

      return NextResponse.json({
        success: true,
        message: 'Send successful!',
        requestDetails,
        sendResult,
      });
    } catch (sendError: any) {
      // Log full error details
      console.error('Full send error:', sendError);
      console.error('Error originalError:', sendError.originalError);

      return NextResponse.json({
        success: false,
        error: sendError.message,
        errorStatusCode: sendError.statusCode,
        errorDetails: sendError.originalError,
        requestDetails,
      });
    }
  } catch (error: any) {
    console.error('Error in test-send:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
