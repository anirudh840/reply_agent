import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, getInterestedLeads } from '@/lib/supabase/queries';

/**
 * GET /api/debug/agent-status
 * Debug endpoint to check agent configuration and auto-send status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const agentName = searchParams.get('name');

    // Get all agents
    const agents = await getAllAgents();

    // Filter by name if provided
    const filteredAgents = agentName
      ? agents.filter((agent) =>
          agent.name.toLowerCase().includes(agentName.toLowerCase())
        )
      : agents;

    const results = await Promise.all(
      filteredAgents.map(async (agent) => {
        // Get interested leads for this agent
        const { data: leads, count } = await getInterestedLeads({
          agent_ids: [agent.id],
        });

        // Categorize leads
        const needsApproval = leads.filter((lead) => lead.needs_approval);
        const autoResponded = leads.filter(
          (lead) => !lead.needs_approval && lead.last_response_sent_at
        );
        const pendingGeneration = leads.filter(
          (lead) => !lead.last_response_generated
        );

        return {
          agent: {
            id: agent.id,
            name: agent.name,
            mode: agent.mode,
            confidence_threshold: agent.confidence_threshold,
            is_active: agent.is_active,
          },
          stats: {
            total_leads: count,
            needs_approval: needsApproval.length,
            auto_responded: autoResponded.length,
            pending_generation: pendingGeneration.length,
          },
          leads: leads.map((lead) => ({
            id: lead.id,
            lead_email: lead.lead_email,
            lead_name: lead.lead_name,
            conversation_status: lead.conversation_status,
            needs_approval: lead.needs_approval,
            response_confidence_score: lead.response_confidence_score,
            last_response_generated: lead.last_response_generated
              ? lead.last_response_generated.substring(0, 100) + '...'
              : null,
            last_response_sent: lead.last_response_sent
              ? lead.last_response_sent.substring(0, 100) + '...'
              : null,
            last_response_sent_at: lead.last_response_sent_at,
            conversation_thread_length: lead.conversation_thread.length,
            created_at: lead.created_at,
          })),
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: results,
    });
  } catch (error: any) {
    console.error('Error in debug agent-status:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch agent status',
      },
      { status: 500 }
    );
  }
}
