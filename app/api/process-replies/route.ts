import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { categorizeReply } from '@/lib/openai/categorizer';
import { generateResponse } from '@/lib/openai/generator';
import { createReply, createInterestedLead, getReplyByEmailBisonId, updateInterestedLead } from '@/lib/supabase/queries';

/**
 * POST /api/process-replies
 * Process new replies from the platform for all active agents
 * Can be called by webhook or cron job
 */
export async function POST(request: NextRequest) {
  try {
    const startTime = Date.now();
    const results = {
      processed: 0,
      interested: 0,
      not_interested: 0,
      errors: 0,
      agents_processed: 0,
    };

    // Get all active agents
    const agents = await getAllAgents();
    const activeAgents = agents.filter((agent) => agent.is_active);

    if (activeAgents.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active agents to process',
        results,
      });
    }

    // Process each agent
    for (const agent of activeAgents) {
      try {
        results.agents_processed++;

        // Create platform client
        const emailbisonClient = createClientForAgent(agent);

        // Fetch ALL non-automated replies (not just pre-filtered "interested")
        // We'll use AI to categorize them properly
        const repliesResult = await emailbisonClient.getReplies({
          limit: 100,
        });

        // Process each reply
        for (const emailbisonReply of repliesResult.data) {
          try {
            // Skip automated replies (OOO, bounce, etc.)
            if (emailbisonReply.is_automated) {
              continue;
            }

            // Check if we've already processed this reply
            const existing = await getReplyByEmailBisonId(emailbisonReply.id);
            if (existing) {
              continue; // Skip already processed replies
            }

            results.processed++;

            // Categorize the reply using AI
            const categorization = await categorizeReply({
              reply: {
                reply_body: emailbisonReply.body,
                reply_subject: emailbisonReply.subject || '',
                original_status: emailbisonReply.status,
              },
              openaiApiKey: agent.openai_api_key,
            });

            // Store reply in database
            const replyRecord = await createReply({
              agent_id: agent.id,
              emailbison_reply_id: emailbisonReply.id,
              emailbison_campaign_id: emailbisonReply.campaign_id,
              lead_email: emailbisonReply.from_email,
              lead_name: emailbisonReply.from_name,
              lead_metadata: emailbisonReply.lead_data || {},
              reply_subject: emailbisonReply.subject,
              reply_body: emailbisonReply.body,
              reply_html: emailbisonReply.html,
              received_at: emailbisonReply.received_at,
              original_status: emailbisonReply.status,
              is_automated_original: emailbisonReply.is_automated,
              is_tracked_original: emailbisonReply.is_tracked,
              corrected_status: categorization.is_truly_interested ? 'interested' : 'not_interested',
              is_truly_interested: categorization.is_truly_interested,
              ai_confidence_score: categorization.confidence_score,
              ai_reasoning: categorization.reasoning,
              processing_status: 'processed',
              processed_at: new Date().toISOString(),
            });

            if (categorization.is_truly_interested) {
              results.interested++;

              // Generate response for interested lead
              const generatedResponse = await generateResponse({
                leadEmail: emailbisonReply.from_email,
                leadName: emailbisonReply.from_name,
                leadMessage: emailbisonReply.body,
                agent,
                conversationHistory: [],
              });

              // Determine if approval is needed
              const needsApproval =
                agent.mode === 'human_in_loop' ||
                generatedResponse.confidence_score < agent.confidence_threshold;

              // Create or update interested lead record
              const interestedLead = await createInterestedLead({
                agent_id: agent.id,
                initial_reply_id: replyRecord.id,
                lead_email: emailbisonReply.from_email,
                lead_name: emailbisonReply.from_name,
                lead_metadata: emailbisonReply.lead_data || {},
                conversation_thread: [
                  {
                    role: 'lead' as const,
                    content: emailbisonReply.body,
                    timestamp: emailbisonReply.received_at,
                    emailbison_message_id: emailbisonReply.id,
                  },
                ],
                last_response_generated: generatedResponse.content,
                response_confidence_score: generatedResponse.confidence_score,
                last_lead_reply_at: emailbisonReply.received_at,
                needs_approval: needsApproval,
                conversation_status: 'active',
                followup_stage: 0,
              });

              if (needsApproval) {
                // Mark for approval
                // This will show up in the inbox for human review
                console.log(`Lead ${interestedLead.id} marked for approval`);
              } else {
                // Auto-send response
                try {
                  const sendResult = await emailbisonClient.sendReply({
                    replyId: emailbisonReply.id,
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

                  console.log(`Auto-sent response to ${emailbisonReply.from_email}`);
                } catch (sendError) {
                  console.error('Error sending auto-reply:', sendError);
                  // Will show in inbox as needs attention
                }
              }
            } else {
              results.not_interested++;
            }
          } catch (replyError: any) {
            console.error(`Error processing reply ${emailbisonReply.id}:`, replyError);
            results.errors++;
          }
        }
      } catch (agentError: any) {
        console.error(`Error processing agent ${agent.id}:`, agentError);
        results.errors++;
      }
    }

    const duration = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} replies across ${results.agents_processed} agents in ${duration}ms`,
      results,
      duration_ms: duration,
    });
  } catch (error: any) {
    console.error('Error in process-replies:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to process replies',
      },
      { status: 500 }
    );
  }
}
