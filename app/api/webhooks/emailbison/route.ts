import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/supabase/queries';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import { createReply, createInterestedLead, getReplyByEmailBisonId } from '@/lib/supabase/queries';
import { createEmailBisonClient } from '@/lib/emailbison/client';

/**
 * POST /api/webhooks/emailbison
 * Webhook endpoint to receive LEAD_REPLIED events from EmailBison
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // Validate webhook payload
    if (!payload || payload.event !== 'LEAD_REPLIED') {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid webhook event type',
        },
        { status: 400 }
      );
    }

    const { reply, campaign, lead } = payload.data || {};

    if (!reply || !reply.id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing reply data in webhook payload',
        },
        { status: 400 }
      );
    }

    console.log(`[Webhook] Received LEAD_REPLIED event for reply ${reply.id}`);

    // Check if we've already processed this reply
    const existingReply = await getReplyByEmailBisonId(reply.id);
    if (existingReply) {
      console.log(`[Webhook] Reply ${reply.id} already processed, skipping`);
      return NextResponse.json({
        success: true,
        message: 'Reply already processed',
      });
    }

    // Skip automated replies (OOO, bounce, etc.)
    if (reply.is_automated) {
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
        reply_body: reply.body || '',
        reply_subject: reply.subject || '',
        original_status: reply.status || 'unknown',
      },
      openaiApiKey: agent.openai_api_key,
    });

    console.log(
      `[Webhook] Categorization result: ${categorization.is_truly_interested ? 'INTERESTED' : 'NOT INTERESTED'} (confidence: ${categorization.confidence_score})`
    );

    // Store reply in database
    const replyRecord = await createReply({
      agent_id: agent.id,
      emailbison_reply_id: reply.id,
      emailbison_campaign_id: campaign?.id || reply.campaign_id || '',
      lead_email: reply.from_email || lead?.email || '',
      lead_name: reply.from_name || lead?.first_name || '',
      lead_metadata: lead || {},
      reply_subject: reply.subject || '',
      reply_body: reply.body || '',
      reply_html: reply.html || '',
      received_at: reply.received_at || new Date().toISOString(),
      original_status: reply.status || 'unknown',
      is_automated_original: reply.is_automated || false,
      is_tracked_original: reply.is_tracked || false,
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

      const generatedResponse = await generateResponse({
        leadEmail: reply.from_email || lead?.email || '',
        leadName: reply.from_name || lead?.first_name || '',
        leadMessage: reply.body || '',
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
        lead_email: reply.from_email || lead?.email || '',
        lead_name: reply.from_name || lead?.first_name || '',
        lead_metadata: lead || {},
        conversation_thread: [
          {
            role: 'lead' as const,
            content: reply.body || '',
            timestamp: reply.received_at || new Date().toISOString(),
            emailbison_message_id: reply.id,
          },
        ],
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        last_lead_reply_at: reply.received_at || new Date().toISOString(),
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
            replyId: reply.id,
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
