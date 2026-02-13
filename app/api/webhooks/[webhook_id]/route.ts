import { NextRequest, NextResponse } from 'next/server';
import { createClientForAgent } from '@/lib/platforms';
import type { PlatformType } from '@/lib/platforms/types';
import type { NormalizedWebhookReply } from '@/lib/platforms/types';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import {
  createReply,
  createInterestedLead,
  getReplyByEmailBisonId,
  updateInterestedLead,
  getAllAgents,
} from '@/lib/supabase/queries';

// =====================================================
// WEBHOOK PAYLOAD NORMALIZERS
// =====================================================

const SMARTLEAD_INTERESTED_CATEGORIES = ['Interested', 'Meeting Request', 'Information Request'];

/**
 * Normalize EmailBison webhook payload.
 *
 * Format:
 * {
 *   "event": { "type": "LEAD_REPLIED", ... },
 *   "data": {
 *     "reply": { id, uuid, email_subject, text_body, from_email_address, ... },
 *     "lead": { id, email, first_name, last_name, ... },
 *     "campaign": { id, name }
 *   }
 * }
 */
function normalizeEmailBisonPayload(webhookData: any): NormalizedWebhookReply {
  if (webhookData.data?.reply) {
    const reply = webhookData.data.reply;
    const lead = webhookData.data.lead || {};
    const campaign = webhookData.data.campaign || {};
    const event = webhookData.event || {};

    return {
      id: reply.id?.toString() || reply.uuid,
      uuid: reply.uuid,
      from_email_address: reply.from_email_address || lead.email,
      from_name: reply.from_name || `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      subject: reply.email_subject || reply.subject,
      text_body: reply.text_body || '',
      html_body: reply.html_body,
      date_received: reply.date_received || reply.created_at,
      interested: reply.interested,
      automated_reply: reply.automated_reply,
      tracked_reply: reply.tracked_reply || (reply.type === 'Tracked Reply'),
      campaign_id: campaign.id?.toString() || reply.campaign_id?.toString(),
      lead_data: {
        ...lead,
        reply_raw: reply,
        campaign,
        event_type: event.type,
        workspace_name: event.workspace_name,
      },
    };
  }

  // Fallback: legacy format where reply is at top level
  const reply = webhookData.reply || webhookData;
  return {
    id: reply.id?.toString() || reply.uuid,
    uuid: reply.uuid,
    from_email_address: reply.from_email_address || reply.from_email,
    from_name: reply.from_name,
    subject: reply.subject || reply.email_subject,
    text_body: reply.text_body || reply.body || '',
    html_body: reply.html_body || reply.html,
    date_received: reply.date_received || reply.received_at || reply.created_at,
    interested: reply.interested,
    automated_reply: reply.automated_reply || reply.is_automated,
    tracked_reply: reply.tracked_reply,
    campaign_id: reply.campaign_id?.toString(),
    lead_data: reply,
  };
}

/**
 * Normalize Smartlead webhook payload.
 *
 * Format:
 * {
 *   "event_type": "EMAIL_REPLY",
 *   "from_email": "...",
 *   "to_email": "...",
 *   "subject": "...",
 *   "category": "Interested" | "Not Interested" | ...,
 *   "campaign_id": 123,
 *   "campaign_name": "...",
 *   "stats_id": "...",
 *   "reply_message": { "text": "...", "html": "...", "message_id": "..." },
 *   "lead": { ... }
 * }
 */
function normalizeSmartleadPayload(webhookData: any): NormalizedWebhookReply {
  const replyMessage = webhookData.reply_message || {};
  const lead = webhookData.lead || {};
  const category = webhookData.category || '';

  return {
    id: webhookData.stats_id?.toString() || webhookData.id?.toString() || '',
    from_email_address: webhookData.from_email || lead.email || '',
    from_name: lead.first_name
      ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim()
      : webhookData.from_email || '',
    subject: webhookData.subject,
    text_body: replyMessage.text || webhookData.reply_text || '',
    html_body: replyMessage.html,
    date_received: webhookData.replied_at || webhookData.timestamp || new Date().toISOString(),
    interested: SMARTLEAD_INTERESTED_CATEGORIES.includes(category),
    automated_reply: category === 'Out Of Office',
    campaign_id: webhookData.campaign_id?.toString(),
    lead_data: {
      ...lead,
      category,
      campaign_name: webhookData.campaign_name,
      event_type: webhookData.event_type,
    },
    // Smartlead-specific fields needed for reply sending
    email_stats_id: webhookData.stats_id?.toString(),
    reply_message_id: replyMessage.message_id,
    reply_email_time: webhookData.replied_at || webhookData.timestamp,
    reply_email_body: replyMessage.text || webhookData.reply_text,
  };
}

/**
 * Normalize Instantly.ai webhook payload.
 *
 * Format:
 * {
 *   "event_type": "reply_received" | "lead_interested",
 *   "timestamp": "...",
 *   "lead_email": "...",
 *   "firstName": "...", "lastName": "...",
 *   "reply_text": "...",
 *   "reply_subject": "...",
 *   "campaign_id": "...",
 *   "campaign_name": "...",
 *   "eaccount": "...",
 *   "reply_to_uuid": "...",
 *   ...
 * }
 */
function normalizeInstantlyPayload(webhookData: any): NormalizedWebhookReply {
  // Instantly may nest data under "body"
  const data = webhookData.body || webhookData;

  return {
    id: data.reply_to_uuid || data.id?.toString() || '',
    uuid: data.reply_to_uuid,
    from_email_address: data.lead_email || data.from_email || '',
    from_name: data.firstName
      ? `${data.firstName || ''} ${data.lastName || ''}`.trim()
      : data.lead_email || '',
    subject: data.reply_subject || data.subject,
    text_body: data.reply_text || data.body_text || '',
    html_body: data.reply_html || data.body_html,
    date_received: data.timestamp || new Date().toISOString(),
    interested: data.event_type === 'lead_interested' || data.ai_interest_value >= 0.5,
    automated_reply: data.is_auto_reply || false,
    campaign_id: data.campaign_id?.toString(),
    lead_data: {
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.lead_email,
      campaign_name: data.campaign_name,
      event_type: data.event_type,
    },
    // Instantly-specific fields needed for reply sending
    eaccount: data.eaccount,
    reply_to_uuid: data.reply_to_uuid,
  };
}

/**
 * Route to the correct normalizer based on the agent's platform
 */
function normalizeWebhookPayload(webhookData: any, platform: PlatformType): NormalizedWebhookReply {
  switch (platform) {
    case 'smartlead':
      return normalizeSmartleadPayload(webhookData);
    case 'instantly':
      return normalizeInstantlyPayload(webhookData);
    case 'emailbison':
    default:
      return normalizeEmailBisonPayload(webhookData);
  }
}

/**
 * POST /api/webhooks/[webhook_id]
 * Dynamic webhook endpoint - routes to specific agent based on webhook_id
 * Supports EmailBison, Smartlead, and Instantly.ai payloads
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

    // Parse and normalize the webhook payload based on agent's platform
    const webhookData = await request.json();
    const platform = (agent.platform || 'emailbison') as PlatformType;
    const reply = normalizeWebhookPayload(webhookData, platform);

    console.log(
      `[Webhook] Received for agent ${agent.name} (${agent.id}):`,
      {
        webhook_id,
        event_type: webhookData.event?.type || webhookData.event || 'unknown',
        reply_id: reply.id,
        from: reply.from_email_address,
        subject: reply.subject,
      }
    );

    // Skip if no reply data
    if (!reply.id || !reply.from_email_address) {
      console.warn('[Webhook] Invalid reply data:', {
        id: reply.id,
        from_email_address: reply.from_email_address,
        payload_keys: Object.keys(webhookData),
        data_keys: webhookData.data ? Object.keys(webhookData.data) : 'no data key',
      });
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid reply data in webhook payload',
        },
        { status: 400 }
      );
    }

    // Skip automated replies
    if (reply.automated_reply) {
      console.log(`[Webhook] Skipping automated reply ${reply.id}`);
      return NextResponse.json({
        success: true,
        message: 'Automated reply skipped',
      });
    }

    // Check if already processed (use both id and uuid)
    const existingById = await getReplyByEmailBisonId(reply.id);
    const existingByUuid = reply.uuid ? await getReplyByEmailBisonId(reply.uuid) : null;
    if (existingById || existingByUuid) {
      console.log(`[Webhook] Reply ${reply.id} already processed`);
      return NextResponse.json({
        success: true,
        message: 'Reply already processed',
      });
    }

    // Categorize the reply using AI
    const categorization = await categorizeReply({
      reply: {
        reply_body: reply.text_body || '',
        reply_subject: reply.subject || '',
        original_status: reply.interested ? 'interested' : 'not_interested',
      },
      openaiApiKey: agent.openai_api_key,
    });

    // Store reply in database
    const replyRecord = await createReply({
      agent_id: agent.id,
      emailbison_reply_id: reply.id,
      emailbison_campaign_id: reply.campaign_id,
      lead_email: reply.from_email_address,
      lead_name: reply.from_name,
      lead_metadata: reply.lead_data,
      reply_subject: reply.subject,
      reply_body: reply.text_body || '',
      reply_html: reply.html_body,
      received_at: reply.date_received || new Date().toISOString(),
      original_status: reply.interested ? 'interested' : 'not_interested',
      is_automated_original: reply.automated_reply || false,
      is_tracked_original: reply.tracked_reply || false,
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
        leadEmail: reply.from_email_address,
        leadName: reply.from_name,
        leadMessage: reply.text_body || '',
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
        lead_email: reply.from_email_address,
        lead_name: reply.from_name,
        lead_metadata: reply.lead_data,
        conversation_thread: [
          {
            role: 'lead' as const,
            content: reply.text_body || '',
            timestamp: reply.date_received || new Date().toISOString(),
            emailbison_message_id: reply.id,
          },
        ],
        last_response_generated: generatedResponse.content,
        response_confidence_score: generatedResponse.confidence_score,
        last_lead_reply_at: reply.date_received || new Date().toISOString(),
        needs_approval: needsApproval,
        conversation_status: 'active',
        followup_stage: 0,
      });

      if (needsApproval) {
        console.log(`[Webhook] Lead ${interestedLead.id} marked for approval`);
      } else {
        // Auto-send response
        try {
          const platformClient = createClientForAgent(agent);

          const sendResult = await platformClient.sendReply({
            replyId: reply.id,
            message: generatedResponse.content,
            campaign_id: reply.campaign_id,
            // Pass platform-specific fields for Smartlead
            email_stats_id: reply.email_stats_id,
            reply_message_id: reply.reply_message_id,
            reply_email_time: reply.reply_email_time,
            reply_email_body: reply.reply_email_body,
            // Pass platform-specific fields for Instantly
            eaccount: reply.eaccount,
            reply_to_uuid: reply.reply_to_uuid,
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

          console.log(`[Webhook] Auto-sent response to ${reply.from_email_address}`);
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
