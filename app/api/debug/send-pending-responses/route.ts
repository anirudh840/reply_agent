import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, getInterestedLeads, updateInterestedLead, getReply } from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import type { ConversationMessage } from '@/lib/types';

/**
 * POST /api/debug/send-pending-responses
 * One-time migration to send pending auto-responses that were generated but never sent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_name, dry_run = true } = body;

    const results = {
      total_found: 0,
      sent: 0,
      errors: 0,
      skipped: 0,
      details: [] as any[],
    };

    // Get agents
    const agents = await getAllAgents();
    const filteredAgents = agent_name
      ? agents.filter((agent) =>
          agent.name.toLowerCase().includes(agent_name.toLowerCase())
        )
      : agents;

    for (const agent of filteredAgents) {
      // Only process fully automated agents
      if (agent.mode !== 'fully_automated') {
        continue;
      }

      // Get all interested leads for this agent
      const { data: leads } = await getInterestedLeads({
        agent_ids: [agent.id],
      });

      // Find leads with generated responses but not sent
      const pendingLeads = leads.filter(
        (lead) =>
          lead.last_response_generated &&
          !lead.last_response_sent &&
          !lead.needs_approval &&
          (lead.response_confidence_score || 0) > agent.confidence_threshold
      );

      results.total_found += pendingLeads.length;

      for (const lead of pendingLeads) {
        try {
          // Get the initial reply to get the emailbison_reply_id
          if (!lead.initial_reply_id) {
            results.skipped++;
            results.details.push({
              lead_id: lead.id,
              lead_email: lead.lead_email,
              status: 'skipped',
              reason: 'No initial_reply_id found',
            });
            continue;
          }

          const reply = await getReply(lead.initial_reply_id);

          if (dry_run) {
            results.details.push({
              lead_id: lead.id,
              lead_email: lead.lead_email,
              agent_name: agent.name,
              confidence_score: lead.response_confidence_score,
              status: 'dry_run',
              would_send: true,
              response_preview: lead.last_response_generated?.substring(0, 100),
            });
            results.sent++;
          } else {
            // Actually send the response
            const emailbisonClient = createClientForAgent(agent);

            const sendResult = await emailbisonClient.sendReply({
              replyId: reply.emailbison_reply_id,
              message: lead.last_response_generated!,
            });

            // Update lead record with sent status
            const updatedThread: ConversationMessage[] = [
              ...lead.conversation_thread,
              {
                role: 'agent',
                content: lead.last_response_generated!,
                timestamp: new Date().toISOString(),
                emailbison_message_id: sendResult.message_id,
              },
            ];

            await updateInterestedLead(lead.id, {
              conversation_thread: updatedThread,
              last_response_sent: lead.last_response_generated!,
              last_response_sent_at: new Date().toISOString(),
              needs_approval: false,
            });

            results.sent++;
            results.details.push({
              lead_id: lead.id,
              lead_email: lead.lead_email,
              agent_name: agent.name,
              confidence_score: lead.response_confidence_score,
              status: 'sent',
              message_id: sendResult.message_id,
            });

            console.log(
              `[Migration] Sent pending response to ${lead.lead_email} for agent ${agent.name}`
            );
          }
        } catch (error: any) {
          results.errors++;
          results.details.push({
            lead_id: lead.id,
            lead_email: lead.lead_email,
            status: 'error',
            error: error.message,
          });
          console.error(`Error sending to ${lead.lead_email}:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      dry_run,
      message: dry_run
        ? `Dry run: Found ${results.total_found} pending responses. Set dry_run=false to actually send them.`
        : `Successfully sent ${results.sent} pending responses`,
      results,
    });
  } catch (error: any) {
    console.error('Error in send-pending-responses:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to send pending responses',
      },
      { status: 500 }
    );
  }
}
