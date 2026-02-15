import { NextRequest, NextResponse } from 'next/server';
import { createClientForAgent } from '@/lib/platforms';
import { EmailBisonClient } from '@/lib/platforms/emailbison';
import type { PlatformType, PlatformReply } from '@/lib/platforms/types';
import type { NormalizedWebhookReply } from '@/lib/platforms/types';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import {
  createReply,
  createInterestedLead,
  getReplyByEmailBisonId,
  updateInterestedLead,
  getAllAgents,
  getInterestedLeadByEmail,
} from '@/lib/supabase/queries';
import { parseEmailThread } from '@/lib/utils/email-parser';
import { refreshConversationThread } from '@/lib/platforms/thread-sync';
import { sendSlackNotification } from '@/lib/integrations/slack';
import { executeBookingAction } from '@/lib/integrations/booking';
import type { ConversationMessage } from '@/lib/types';

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

    // Check if already processed for THIS agent (use both id and uuid)
    const existingById = await getReplyByEmailBisonId(reply.id, agent.id);
    const existingByUuid = reply.uuid ? await getReplyByEmailBisonId(reply.uuid, agent.id) : null;
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

    // ===================================================================
    // BUILD CONVERSATION THREAD
    // Strategy:
    //  1. Try to fetch full conversation from platform API (lead_id filter)
    //  2. Fall back to parsing quoted text from the current reply body
    // ===================================================================

    let conversationThread: ConversationMessage[] = [];
    const leadId = reply.lead_data?.id?.toString();

    // Step 1: Try fetching the full thread from the platform API
    if (leadId && platform === 'emailbison') {
      try {
        const platformClient = createClientForAgent(agent);
        if (platformClient instanceof EmailBisonClient) {
          const allReplies = await platformClient.getRepliesByLeadId(leadId);

          if (allReplies.length > 0) {
            console.log(
              `[Webhook] Fetched ${allReplies.length} replies from API for lead ${leadId}`
            );

            // Sort by date ascending (oldest first) for chronological order
            const sorted = [...allReplies].sort(
              (a, b) =>
                new Date(a.received_at).getTime() -
                new Date(b.received_at).getTime()
            );

            // Build thread: each API reply is a separate card
            // Parse each reply to strip quoted text (keep only the actual new content)
            // Determine direction by comparing from_email with the lead's email
            const leadEmailLower = reply.from_email_address.toLowerCase();

            for (const apiReply of sorted) {
              const parsed = parseEmailThread(apiReply.body);
              const actualContent = parsed.length > 0
                ? parsed[0].content
                : apiReply.body;

              const replyFromEmail = (apiReply.from_email || '').toLowerCase();
              const isFromLead = replyFromEmail === leadEmailLower;

              conversationThread.push({
                role: isFromLead ? 'lead' : 'agent',
                content: actualContent,
                timestamp: apiReply.received_at,
                emailbison_message_id: apiReply.id,
                from: apiReply.from_name || apiReply.from_email,
              });
            }
          }
        }
      } catch (apiError) {
        console.warn(
          '[Webhook] Could not fetch thread from API, falling back to parsing:',
          apiError
        );
      }
    }

    // Step 2: If API didn't yield results, parse the inline quoted text
    if (conversationThread.length === 0) {
      const parsedMessages = parseEmailThread(
        reply.text_body || '',
        reply.html_body
      );
      console.log(
        `[Webhook] Parsed ${parsedMessages.length} messages from email body`
      );

      conversationThread = parsedMessages.map((msg, index) => ({
        role: 'lead' as const,
        content: msg.content,
        timestamp:
          index === 0
            ? reply.date_received || new Date().toISOString()
            : msg.date || new Date().toISOString(),
        emailbison_message_id: index === 0 ? reply.id : undefined,
        is_quoted: msg.isQuoted,
        from: msg.from || (index === 0 ? reply.from_name : undefined),
      }));
    }

    // If we still have nothing, create a single-message thread
    if (conversationThread.length === 0) {
      conversationThread = [
        {
          role: 'lead',
          content: reply.text_body || '',
          timestamp: reply.date_received || new Date().toISOString(),
          emailbison_message_id: reply.id,
          from: reply.from_name,
        },
      ];
    }

    // Also include the original outbound email info from the webhook payload
    // if available (scheduled_email data)
    const scheduledEmail = reply.lead_data?.reply_raw
      ? undefined // Already in lead_data
      : webhookData?.data?.scheduled_email;
    const senderEmail = webhookData?.data?.sender_email;

    if (
      scheduledEmail?.sent_at &&
      senderEmail?.email &&
      !conversationThread.some(
        (m) => m.role === 'agent' && !m.is_quoted
      )
    ) {
      // We don't have the body of the original sent email from the webhook,
      // but we can add a placeholder showing it was sent
      // The actual content will be visible in the quoted portion of the reply
      const quotedOriginal = conversationThread.find(
        (m) => m.is_quoted && m.role === 'lead'
      );

      if (quotedOriginal) {
        // Convert the quoted message to an agent outbound
        quotedOriginal.role = 'agent';
        quotedOriginal.from =
          senderEmail.name || senderEmail.email;
        quotedOriginal.timestamp = scheduledEmail.sent_at;
        quotedOriginal.is_quoted = false;
      }
    }

    // Check if this lead already exists (for follow-up replies)
    const existingLead = await getInterestedLeadByEmail(agent.id, reply.from_email_address);

    // Build the full conversation thread (merge existing + new messages)
    let fullThread: ConversationMessage[] = [];
    if (existingLead) {
      fullThread = [...existingLead.conversation_thread, ...conversationThread];
    } else {
      fullThread = conversationThread;
    }

    // Update existing lead's thread immediately
    if (existingLead) {
      await updateInterestedLead(existingLead.id, {
        conversation_thread: fullThread,
        last_lead_reply_at: reply.date_received || new Date().toISOString(),
        conversation_status: 'active',
      });
      console.log(`[Webhook] Updated existing lead ${existingLead.id} with new reply`);
    }

    // Generate AI response for ALL interested replies (first reply or follow-up)
    if (categorization.is_truly_interested) {
      // Get the latest lead message for the AI prompt
      const latestLeadContent = conversationThread[conversationThread.length - 1]?.content || reply.text_body || '';

      // Use full thread as conversation history for context
      const historyForAI = fullThread.slice(0, -1); // All messages except the latest one

      const generatedResponse = await generateResponse({
        leadEmail: reply.from_email_address,
        leadName: reply.from_name,
        leadMessage: latestLeadContent,
        agent,
        conversationHistory: historyForAI,
      });

      // Execute booking action if AI requested one
      if (generatedResponse.booking_action) {
        try {
          const bookingAction = {
            ...generatedResponse.booking_action,
            attendee_name: generatedResponse.booking_action.attendee_name || reply.from_name || 'Lead',
            attendee_email: generatedResponse.booking_action.attendee_email || reply.from_email_address,
          };
          const bookingResult = await executeBookingAction(agent, bookingAction);
          if (bookingResult.success) {
            console.log(`[Webhook] Booking action executed:`, bookingResult);
          } else {
            console.warn(`[Webhook] Booking action failed:`, bookingResult.error);
          }
        } catch (bookingError) {
          console.warn('[Webhook] Booking action error:', bookingError);
        }
      }

      // Determine if approval is needed and why
      const isLowConfidence = generatedResponse.confidence_score <= agent.confidence_threshold;
      const isHumanInLoop = agent.mode === 'human_in_loop';
      const needsApproval = isHumanInLoop || isLowConfidence;

      let approvalReason: string | undefined;
      if (needsApproval) {
        const reasons: string[] = [];
        if (isHumanInLoop) {
          reasons.push('Agent is in Human-in-Loop mode — all responses require manual approval');
        }
        if (isLowConfidence) {
          reasons.push(
            `AI confidence score (${generatedResponse.confidence_score}/10) is below the agent's threshold (${agent.confidence_threshold}/10)`
          );
        }
        approvalReason = reasons.join('. ');
        if (categorization.reasoning) {
          approvalReason += `\n\nAI Analysis: ${categorization.reasoning}`;
        }
      }

      // The lead record to operate on (existing or newly created)
      let leadRecord;

      if (existingLead) {
        // Update existing lead with new AI response
        await updateInterestedLead(existingLead.id, {
          last_response_generated: generatedResponse.content,
          response_confidence_score: generatedResponse.confidence_score,
          needs_approval: needsApproval,
          approval_reason: approvalReason,
        });
        leadRecord = { ...existingLead, conversation_thread: fullThread };
        console.log(`[Webhook] Generated follow-up AI response for existing lead ${existingLead.id}`);
      } else {
        // Create new interested lead record
        leadRecord = await createInterestedLead({
          agent_id: agent.id,
          initial_reply_id: replyRecord.id,
          lead_email: reply.from_email_address,
          lead_name: reply.from_name,
          lead_metadata: reply.lead_data,
          conversation_thread: fullThread,
          last_response_generated: generatedResponse.content,
          response_confidence_score: generatedResponse.confidence_score,
          last_lead_reply_at: reply.date_received || new Date().toISOString(),
          needs_approval: needsApproval,
          approval_reason: approvalReason,
          conversation_status: 'active',
          followup_stage: 0,
        });
      }

      if (needsApproval) {
        console.log(`[Webhook] Lead ${leadRecord.id} marked for approval`);
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

          const now = new Date().toISOString();

          // Refresh thread from the platform API to get the complete conversation
          const refreshedThread = await refreshConversationThread({
            lead: leadRecord,
            agent,
            sentMessage: {
              content: generatedResponse.content,
              timestamp: now,
              message_id: sendResult.message_id,
            },
          });

          await updateInterestedLead(leadRecord.id, {
            conversation_thread: refreshedThread,
            last_response_sent: generatedResponse.content,
            last_response_sent_at: now,
            needs_approval: false,
          });

          console.log(`[Webhook] Auto-sent response to ${reply.from_email_address}`);
        } catch (sendError) {
          console.error('[Webhook] Error sending auto-reply:', sendError);
        }
      }

      // Send Slack notification (non-blocking)
      if (agent.slack_webhook_url) {
        try {
          const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
            ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
            : process.env.VERCEL_URL
              ? `https://${process.env.VERCEL_URL}`
              : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

          // Parse the email to extract only the latest message (strip quoted thread)
          const parsedMessages = parseEmailThread(reply.text_body || '');
          const latestMessage = parsedMessages.length > 0
            ? parsedMessages[0].content
            : (reply.text_body || '');

          await sendSlackNotification(agent.slack_webhook_url, {
            leadName: reply.from_name,
            leadEmail: reply.from_email_address,
            leadCompany: reply.lead_data?.company_name || reply.lead_data?.company,
            leadMessage: latestMessage.slice(0, 500),
            categorization: {
              is_interested: categorization.is_truly_interested,
              confidence_score: categorization.confidence_score,
              reasoning: categorization.reasoning,
            },
            responseAction: needsApproval ? 'needs_approval' : 'auto_responded',
            agentName: agent.name,
            inboxUrl: `${appUrl}/inbox`,
            generatedResponse: generatedResponse.content,
          });
          console.log(`[Webhook] Slack notification sent for lead ${reply.from_email_address}`);
        } catch (slackError) {
          console.warn('[Webhook] Failed to send Slack notification:', slackError);
        }
      }

      return NextResponse.json({
        success: true,
        message: needsApproval
          ? 'Reply processed and marked for approval'
          : 'Reply processed and auto-responded',
        data: {
          reply_id: replyRecord.id,
          lead_id: leadRecord.id,
          auto_sent: !needsApproval,
          is_followup: !!existingLead,
        },
      });
    } else {
      // Not interested - still create lead record for inbox visibility
      // but don't generate AI response
      if (!existingLead) {
        const interestedLead = await createInterestedLead({
          agent_id: agent.id,
          initial_reply_id: replyRecord.id,
          lead_email: reply.from_email_address,
          lead_name: reply.from_name,
          lead_metadata: reply.lead_data,
          conversation_thread: fullThread,
          last_lead_reply_at: reply.date_received || new Date().toISOString(),
          needs_approval: false,
          conversation_status: 'paused',
          followup_stage: 0,
        });

        console.log(
          `[Webhook] Reply marked as not interested, created lead record ${interestedLead.id} for visibility`
        );

        return NextResponse.json({
          success: true,
          message: 'Reply processed as not interested',
          data: {
            reply_id: replyRecord.id,
            lead_id: interestedLead.id,
          },
        });
      } else {
        console.log(`[Webhook] Updated existing lead with not interested reply`);

        return NextResponse.json({
          success: true,
          message: 'Reply processed as not interested',
          data: {
            reply_id: replyRecord.id,
            lead_id: existingLead.id,
          },
        });
      }
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
