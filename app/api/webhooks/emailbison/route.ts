import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/supabase/queries';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import { createReply, createInterestedLead, getReplyByEmailBisonId } from '@/lib/supabase/queries';
import { createEmailBisonClient } from '@/lib/emailbison/client';

/**
 * GET /api/webhooks/emailbison
 * Test endpoint to verify webhook is accessible
 */
export async function GET(request: NextRequest) {
  return NextResponse.json({
    success: true,
    message: 'EmailBison webhook endpoint is active',
    timestamp: new Date().toISOString(),
  });
}

/**
 * POST /api/webhooks/emailbison
 * Webhook endpoint to receive LEAD_REPLIED events from EmailBison
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // Log the entire payload for debugging
    console.log('[Webhook] Received payload:', JSON.stringify(payload, null, 2));

    // Validate webhook payload - EmailBison sends event.type, not just event
    if (!payload || !payload.event || payload.event.type !== 'LEAD_REPLIED') {
      console.log('[Webhook] Invalid event type:', payload?.event?.type);
      return NextResponse.json(
        {
          success: false,
          error: `Invalid webhook event type: ${payload?.event?.type || 'unknown'}. Expected LEAD_REPLIED.`,
          received_event: payload?.event?.type,
        },
        { status: 400 }
      );
    }

    const { reply, campaign, lead } = payload.data || {};

    if (!reply || !reply.id) {
      console.log('[Webhook] Missing reply data:', { hasReply: !!reply, hasId: !!reply?.id });
      return NextResponse.json(
        {
          success: false,
          error: 'Missing reply data in webhook payload',
          payload_structure: {
            has_data: !!payload.data,
            has_reply: !!reply,
            has_reply_id: !!reply?.id,
          },
        },
        { status: 400 }
      );
    }

    console.log(`[Webhook] Received LEAD_REPLIED event for reply ${reply.id}`);

    // Check if we've already processed this reply
    const existingReply = await getReplyByEmailBisonId(String(reply.id));
    if (existingReply) {
      console.log(`[Webhook] Reply ${reply.id} already processed, skipping`);
      return NextResponse.json({
        success: true,
        message: 'Reply already processed',
      });
    }

    // Skip automated replies (OOO, bounce, etc.)
    if (reply.automated_reply) {
      console.log(`[Webhook] Reply ${reply.id} is automated, skipping`);
      return NextResponse.json({
        success: true,
        message: 'Automated reply skipped',
      });
    }

    // Find the agent for this campaign
    // We need to match by campaign or workspace since we don't have the API key in the webhook
    const agents = await getAllAgents();
    const activeAgents = agents.filter((agent) => agent.is_active);

    if (activeAgents.length === 0) {
      console.error('[Webhook] No active agents found');
      return NextResponse.json(
        {
          success: false,
          error: 'No active agents configured',
        },
        { status: 400 }
      );
    }

    // For now, use the first active agent
    // In the future, we could match by workspace_id or campaign_id
    const agent = activeAgents[0];

    if (activeAgents.length > 1) {
      console.warn(
        `[Webhook] Multiple active agents found, using first agent: ${agent.id} (${agent.name})`
      );
    }

    console.log(`[Webhook] Processing reply ${reply.id} for agent ${agent.id} (${agent.name})`);

    // Categorize the reply using AI
    const categorization = await categorizeReply({
      reply: {
        reply_body: reply.text_body || '',
        reply_subject: reply.email_subject || '',
        original_status: reply.interested ? 'interested' : 'not_interested',
      },
      openaiApiKey: agent.openai_api_key,
    });

    console.log(
      `[Webhook] Categorization result: ${categorization.is_truly_interested ? 'INTERESTED' : 'NOT INTERESTED'} (confidence: ${categorization.confidence_score})`
    );

    // Store reply in database
    const replyRecord = await createReply({
      agent_id: agent.id,
      emailbison_reply_id: String(reply.id),
      emailbison_campaign_id: String(campaign?.id || ''),
      lead_email: reply.from_email_address || lead?.email || '',
      lead_name: reply.from_name || `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() || '',
      lead_metadata: lead || {},
      reply_subject: reply.email_subject || '',
      reply_body: reply.text_body || '',
      reply_html: reply.html_body || '',
      received_at: reply.date_received || new Date().toISOString(),
      original_status: reply.interested ? 'interested' : 'not_interested',
      is_automated_original: reply.automated_reply || false,
      is_tracked_original: reply.type === 'Tracked Reply',
      corrected_status: categorization.is_truly_interested ? 'interested' : 'not_interested',
      is_truly_interested: categorization.is_truly_interested,
      ai_confidence_score: categorization.confidence_score,
      ai_reasoning: categorization.reasoning,
      processing_status: 'processed',
      processed_at: new Date().toISOString(),
    });

    console.log(`[Webhook] Created reply record: ${replyRecord.id}`);

    // If truly interested, generate response and create interested lead
    if (categorization.is_truly_interested) {
      console.log(`[Webhook] Generating response for interested lead`);

      const leadEmail = reply.from_email_address || lead?.email || '';
      const leadName = reply.from_name || `${lead?.first_name || ''} ${lead?.last_name || ''}`.trim() || '';
      const leadMessage = reply.text_body || '';

      const generatedResponse = await generateResponse({
        leadEmail,
        leadName,
        leadMessage,
        agent,
        conversationHistory: [],
      });

      console.log(
        `[Webhook] Generated response with confidence ${generatedResponse.confidence_score}`
      );

      // Determine if approval is needed
      const needsApproval =
        agent.mode === 'human_in_loop' ||
        generatedResponse.confidence_score < agent.confidence_threshold;

      // Create interested lead record
      const interestedLead = await createInterestedLead({
        agent_id: agent.id,
        initial_reply_id: replyRecord.id,
        lead_email: leadEmail,
        lead_name: leadName,
        lead_metadata: lead || {},
        conversation_thread: [
          {
            role: 'lead' as const,
            content: leadMessage,
            timestamp: reply.date_received || new Date().toISOString(),
            emailbison_message_id: String(reply.id),
          },
        ],
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        last_lead_reply_at: reply.date_received || new Date().toISOString(),
        needs_approval: needsApproval,
        conversation_status: 'active',
        followup_stage: 0,
      });

      console.log(
        `[Webhook] Created interested lead: ${interestedLead.id} (needs_approval: ${needsApproval})`
      );

      // If auto-send is enabled and confidence is high enough, send the response
      if (!needsApproval) {
        try {
          const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);
          await emailbisonClient.sendReply({
            replyId: String(reply.id),
            message: generatedResponse.content,
          });

          console.log(`[Webhook] Auto-sent response for reply ${reply.id}`);

          // TODO: Update interested_lead with sent status and timestamp
        } catch (sendError) {
          console.error('[Webhook] Error sending auto-reply:', sendError);
          // Lead will show in inbox as needs attention
        }
      }

      return NextResponse.json({
        success: true,
        message: 'Reply processed and interested lead created',
        data: {
          reply_id: replyRecord.id,
          lead_id: interestedLead.id,
          is_interested: true,
          needs_approval: needsApproval,
        },
      });
    }

    // Not interested - just acknowledge
    return NextResponse.json({
      success: true,
      message: 'Reply processed (not interested)',
      data: {
        reply_id: replyRecord.id,
        is_interested: false,
      },
    });
  } catch (error: any) {
    console.error('[Webhook] Error processing webhook:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to process webhook',
      },
      { status: 500 }
    );
  }
}
