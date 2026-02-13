import { NextRequest, NextResponse } from 'next/server';
import {
  getAgents,
  getLeadsDueForFollowup,
  updateInterestedLead,
  createFeedbackLog,
} from '@/lib/supabase/queries';
import { generateFollowup } from '@/lib/openai/generator';
import { createClientForAgent } from '@/lib/platforms';
import type { ConversationMessage } from '@/lib/types';
import { addDays } from 'date-fns';

/**
 * POST /api/followups/schedule
 * Process and send due follow-ups (called by cron job)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret (optional security)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized',
        },
        { status: 401 }
      );
    }

    console.log('Starting follow-up processing...');

    // Get all active agents
    const agents = await getAgents(true);

    const results = {
      total_leads_processed: 0,
      followups_sent: 0,
      errors: 0,
      error_details: [] as string[],
    };

    // Process each agent
    for (const agent of agents) {
      try {
        // Get leads due for follow-up for this agent
        const dueLeads = await getLeadsDueForFollowup(agent.id);

        console.log(
          `Found ${dueLeads.length} leads due for follow-up for agent ${agent.name}`
        );

        results.total_leads_processed += dueLeads.length;

        // Process each lead
        for (const lead of dueLeads) {
          try {
            const nextStage = lead.followup_stage + 1;

            // Check if we've exceeded the follow-up sequence
            if (nextStage > agent.followup_sequence.steps.length) {
              console.log(
                `Lead ${lead.lead_email} has exhausted follow-up sequence`
              );

              // Mark as unresponsive
              await updateInterestedLead(lead.id, {
                conversation_status: 'unresponsive',
                next_followup_due_at: undefined,
              });

              continue;
            }

            // Generate follow-up
            const followup = await generateFollowup({
              lead,
              agent,
              followupStage: nextStage,
            });

            // Create platform client
            const emailbisonClient = createClientForAgent(agent);

            // Get the last message ID to reply to
            const lastLeadMessage = lead.conversation_thread
              .filter((msg) => msg.role === 'lead')
              .slice(-1)[0];

            if (!lastLeadMessage?.emailbison_message_id) {
              throw new Error('No platform message ID found');
            }

            // Send follow-up
            const sendResult = await emailbisonClient.sendReply({
              replyId: lastLeadMessage.emailbison_message_id,
              message: followup.content,
            });

            if (!sendResult.success) {
              throw new Error('Failed to send follow-up email');
            }

            // Add to conversation thread
            const agentMessage: ConversationMessage = {
              role: 'agent',
              content: followup.content,
              timestamp: new Date().toISOString(),
              emailbison_message_id: sendResult.message_id,
            };

            const updatedThread = [...lead.conversation_thread, agentMessage];

            // Calculate next follow-up date (if not the last one)
            let nextFollowupDate: Date | null = null;

            if (nextStage < agent.followup_sequence.steps.length) {
              const nextFollowupConfig =
                agent.followup_sequence.steps[nextStage];
              nextFollowupDate = addDays(
                new Date(),
                nextFollowupConfig.delay_days
              );
            }

            // Update lead
            await updateInterestedLead(lead.id, {
              conversation_thread: updatedThread,
              last_response_sent: followup.content,
              last_response_sent_at: new Date().toISOString(),
              followup_stage: nextStage,
              next_followup_due_at: nextFollowupDate?.toISOString() || undefined,
              conversation_status:
                nextStage >= agent.followup_sequence.steps.length
                  ? 'completed'
                  : 'active',
            });

            // Log as automatically sent
            await createFeedbackLog({
              agent_id: agent.id,
              lead_id: lead.id,
              feedback_type: 'accepted',
              original_response: followup.content,
              user_edited_response: undefined,
              corrections: undefined,
              extracted_patterns: undefined,
              applied_to_knowledge_base: false,
            });

            results.followups_sent++;

            console.log(
              `Sent follow-up ${nextStage} to ${lead.lead_email}`
            );
          } catch (leadError: any) {
            console.error(
              `Error processing lead ${lead.lead_email}:`,
              leadError
            );
            results.errors++;
            results.error_details.push(
              `${lead.lead_email}: ${leadError.message}`
            );
          }
        }
      } catch (agentError: any) {
        console.error(
          `Error processing agent ${agent.name}:`,
          agentError
        );
        results.errors++;
        results.error_details.push(`Agent ${agent.name}: ${agentError.message}`);
      }
    }

    console.log('Follow-up processing complete:', results);

    return NextResponse.json({
      success: true,
      data: results,
      message: `Processed ${results.total_leads_processed} leads, sent ${results.followups_sent} follow-ups`,
    });
  } catch (error: any) {
    console.error('Error in follow-up scheduler:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to process follow-ups',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/followups/schedule
 * Get leads due for follow-up (for manual checking)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get('agent_id') || undefined;

    const dueLeads = await getLeadsDueForFollowup(agentId);

    return NextResponse.json({
      success: true,
      data: dueLeads,
      total: dueLeads.length,
    });
  } catch (error: any) {
    console.error('Error fetching due follow-ups:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch due follow-ups',
      },
      { status: 500 }
    );
  }
}
