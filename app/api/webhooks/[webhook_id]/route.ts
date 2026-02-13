import { NextRequest, NextResponse } from 'next/server';
import { createEmailBisonClient } from '@/lib/emailbison/client';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import {
  createReply,
  createInterestedLead,
  getReplyByEmailBisonId,
  updateInterestedLead,
  getAllAgents,
} from '@/lib/supabase/queries';

/**
 * POST /api/webhooks/[webhook_id]
 * Dynamic webhook endpoint for EmailBison - routes to specific agent based on webhook_id
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ webhook_id: string }> }
) {
  try {
    const { webhook_id } = await params;

    // Find agent by webhook_id
    const agents = await getAllAgents();
    const agent = agents.find((a) => a.webhook_id === webhook_id);

    if (!agent) {
      console.error(`No agent found for webhook_id: ${webhook_id}`);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid webhook URL - agent not found',
        },
        { status: 404 }
      );
    }

    if (!agent.is_active) {
      console.warn(`Agent ${agent.id} is inactive, skipping webhook processing`);
      return NextResponse.json(
        {
          success: true,
          message: 'Agent is inactive, webhook received but not processed',
        },
        { status: 200 }
      );
    }

    // Parse EmailBison webhook payload
    const webhookData = await request.json();

    console.log(
      `[Webhook] Received webhook for agent ${agent.name} (${agent.id}):`,
      {
        webhook_id,
        event_type: webhookData.event || 'unknown',
        reply_id: webhookData.reply?.id,
      }
    );

    // EmailBison webhook format may vary - adapt based on actual payload structure
    // Assuming structure: { event: 'reply.received', reply: { id, from_email, body, ... } }
    const emailbisonReply = webhookData.reply || webhookData;

    // Skip if no reply data (EmailBison uses from_email_address)
    if (!emailbisonReply.id || (!emailbisonReply.from_email_address && !emailbisonReply.from_email)) {
      console.warn('[Webhook] Invalid reply data received:', JSON.stringify({ id: emailbisonReply.id, from_email_address: emailbisonReply.from_email_address, from_email: emailbisonReply.from_email }));
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid reply data in webhook payload',
        },
        { status: 400 }
      );
    }

    // Skip automated replies
    if (emailbisonReply.automated_reply || emailbisonReply.is_automated) {
      console.log(`[Webhook] Skipping automated reply ${emailbisonReply.id}`);
      return NextResponse.json({
        success: true,
        message: 'Automated reply skipped',
      });
    }

    // Check if already processed
    const existing = await getReplyByEmailBisonId(emailbisonReply.id);
    if (existing) {
      console.log(`[Webhook] Reply ${emailbisonReply.id} already processed`);
      return NextResponse.json({
        success: true,
        message: 'Reply already processed',
      });
    }

    // Categorize the reply using AI
    const categorization = await categorizeReply({
      reply: {
        reply_body: emailbisonReply.text_body || emailbisonReply.body || '',
        reply_subject: emailbisonReply.subject || '',
        original_status: emailbisonReply.interested ? 'interested' : 'not_interested',
      },
      openaiApiKey: agent.openai_api_key,
    });

    // Store reply in database
    const replyRecord = await createReply({
      agent_id: agent.id,
      emailbison_reply_id: emailbisonReply.id.toString(),
      emailbison_campaign_id: emailbisonReply.campaign_id?.toString(),
      lead_email: emailbisonReply.from_email_address || emailbisonReply.from_email,
      lead_name: emailbisonReply.from_name,
      lead_metadata: emailbisonReply,
      reply_subject: emailbisonReply.subject,
      reply_body: emailbisonReply.text_body || emailbisonReply.body || '',
      reply_html: emailbisonReply.html_body || emailbisonReply.html,
      received_at: emailbisonReply.date_received || emailbisonReply.received_at || new Date().toISOString(),
      original_status: emailbisonReply.interested ? 'interested' : 'not_interested',
      is_automated_original: emailbisonReply.automated_reply || false,
      is_tracked_original: emailbisonReply.tracked_reply || false,
      corrected_status: categorization.is_truly_interested ? 'interested' : 'not_interested',
      is_truly_interested: categorization.is_truly_interested,
      ai_confidence_score: categorization.confidence_score,
      ai_reasoning: categorization.reasoning,
      processing_status: 'processed',
      processed_at: new Date().toISOString(),
    });

    console.log(
      `[Webhook] Categorized reply as ${categorization.is_truly_interested ? 'interested' : 'not interested'} (confidence: ${categorization.confidence_score}/10)`
    );

    // Only process further if truly interested
    if (categorization.is_truly_interested) {
      // Generate response for interested lead
      const generatedResponse = await generateResponse({
        leadEmail: emailbisonReply.from_email_address || emailbisonReply.from_email,
        leadName: emailbisonReply.from_name,
        leadMessage: emailbisonReply.text_body || emailbisonReply.body || '',
        agent,
        conversationHistory: [],
      });

      // Determine if approval is needed
      const needsApproval =
        agent.mode === 'human_in_loop' ||
        generatedResponse.confidence_score <= agent.confidence_threshold;

      // Create interested lead record
      const interestedLead = await createInterestedLead({
        agent_id: agent.id,
        initial_reply_id: replyRecord.id,
        lead_email: emailbisonReply.from_email_address || emailbisonReply.from_email,
        lead_name: emailbisonReply.from_name,
        lead_metadata: emailbisonReply,
        conversation_thread: [
          {
            role: 'lead' as const,
            content: emailbisonReply.text_body || emailbisonReply.body || '',
            timestamp: emailbisonReply.date_received || emailbisonReply.received_at || new Date().toISOString(),
            emailbison_message_id: emailbisonReply.id.toString(),
          },
        ],
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        last_lead_reply_at: emailbisonReply.date_received || emailbisonReply.received_at || new Date().toISOString(),
        needs_approval: needsApproval,
        conversation_status: 'active',
        followup_stage: 0,
      });

      if (needsApproval) {
        console.log(`[Webhook] Lead ${interestedLead.id} marked for approval`);
      } else {
        // Auto-send response
        try {
          const emailbisonClient = createEmailBisonClient(agent.emailbison_api_key);

          const sendResult = await emailbisonClient.sendReply({
            replyId: emailbisonReply.id.toString(),
            message: generatedResponse.content,
          });

          // Update lead record with sent status
          const updatedThread = [
            ...interestedLead.conversation_thread,
            {
              role: 'agent' as const,
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

          console.log(`[Webhook] Auto-sent response to ${emailbisonReply.from_email_address || emailbisonReply.from_email}`);
        } catch (sendError) {
          console.error('[Webhook] Error sending auto-reply:', sendError);
        }
      }

      return NextResponse.json({
        success: true,
        message: needsApproval
          ? 'Reply processed and marked for approval'
          : 'Reply processed and auto-responded',
        data: {
          reply_id: replyRecord.id,
          lead_id: interestedLead.id,
          auto_sent: !needsApproval,
        },
      });
    } else {
      // Not interested - just store and skip
      console.log(`[Webhook] Reply marked as not interested, stored but no response generated`);

      return NextResponse.json({
        success: true,
        message: 'Reply processed as not interested',
        data: {
          reply_id: replyRecord.id,
        },
      });
    }
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
