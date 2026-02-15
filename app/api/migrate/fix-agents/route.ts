import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAgents,
  getReplies,
  getInterestedLeads,
  updateReply,
  updateInterestedLead,
} from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import type { Agent } from '@/lib/types';

/**
 * POST /api/migrate/fix-agents
 *
 * Intelligent migration that:
 * 1. For each EmailBison agent, calls the API to discover which campaign IDs
 *    their API key has access to (this definitively identifies the workspace).
 * 2. Builds a campaign_id → agent mapping.
 * 3. Re-assigns replies & interested_leads to the correct agent based on
 *    their emailbison_campaign_id.
 *
 * Pass ?dry_run=true to preview changes without writing anything.
 */
export async function POST(request: NextRequest) {
  const dryRun =
    request.nextUrl.searchParams.get('dry_run') === 'true';

  const log: string[] = [];
  const push = (msg: string) => {
    console.log(`[FixAgents] ${msg}`);
    log.push(msg);
  };

  try {
    push(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');

    // ---------------------------------------------------------------
    // 1. Load all agents
    // ---------------------------------------------------------------
    const agents = await getAllAgents();
    const agentById = new Map<string, Agent>();
    for (const agent of agents) {
      agentById.set(agent.id, agent);
    }

    push(
      `Loaded ${agents.length} agents:\n` +
        agents
          .map(
            (a) =>
              `  - "${a.name}" (id: ${a.id.slice(0, 8)}…, platform: ${a.platform || 'emailbison'})`
          )
          .join('\n')
    );

    // ---------------------------------------------------------------
    // 2. For each EmailBison agent, fetch their accessible campaigns
    //    to build campaign_id → agent_id mapping
    // ---------------------------------------------------------------
    const campaignToAgent = new Map<string, string>();
    const agentCampaignCounts = new Map<string, number>();

    const emailbisonAgents = agents.filter(
      (a) => (a.platform || 'emailbison') === 'emailbison'
    );

    push(`\nFetching campaigns for ${emailbisonAgents.length} EmailBison agents...`);

    for (const agent of emailbisonAgents) {
      try {
        const client = createClientForAgent(agent);
        const { data: campaigns } = await client.getCampaigns();

        const campaignIds = campaigns.map((c) => c.id?.toString()).filter(Boolean);
        agentCampaignCounts.set(agent.id, campaignIds.length);

        for (const cid of campaignIds) {
          if (campaignToAgent.has(cid)) {
            // Campaign accessible by multiple agents — log overlap
            const existingAgent = agentById.get(campaignToAgent.get(cid)!)!;
            push(
              `  OVERLAP: campaign ${cid} accessible by both "${existingAgent.name}" and "${agent.name}"`
            );
          } else {
            campaignToAgent.set(cid, agent.id);
          }
        }

        push(
          `  "${agent.name}": ${campaignIds.length} campaigns → [${campaignIds.slice(0, 10).join(', ')}${campaignIds.length > 10 ? '...' : ''}]`
        );
      } catch (err: any) {
        push(`  ERROR fetching campaigns for "${agent.name}": ${err.message}`);
      }
    }

    push(`\nTotal campaign→agent mappings: ${campaignToAgent.size}`);

    // ---------------------------------------------------------------
    // 3. Load all replies and interested_leads
    // ---------------------------------------------------------------
    const { data: allReplies } = await getReplies({ limit: 1000 });
    const { data: allLeads } = await getInterestedLeads({ limit: 1000 });

    push(`Found ${allReplies.length} replies and ${allLeads.length} interested_leads`);

    // ---------------------------------------------------------------
    // 4. Fix agent_id on replies based on campaign mapping
    // ---------------------------------------------------------------
    let repliesFixed = 0;
    let repliesNoMatch = 0;

    // Group by agent for summary
    const replyMoves: Record<string, number> = {};

    for (const reply of allReplies) {
      const campaignId = reply.emailbison_campaign_id?.toString();
      if (!campaignId) continue;

      const correctAgentId = campaignToAgent.get(campaignId);
      if (!correctAgentId) {
        repliesNoMatch++;
        continue;
      }

      if (reply.agent_id !== correctAgentId) {
        const oldAgent = agentById.get(reply.agent_id);
        const newAgent = agentById.get(correctAgentId);
        const key = `"${oldAgent?.name}" → "${newAgent?.name}"`;
        replyMoves[key] = (replyMoves[key] || 0) + 1;

        if (!dryRun) {
          await updateReply(reply.id, { agent_id: correctAgentId } as any);
        }
        repliesFixed++;
      }
    }

    push(`\nReplies re-assigned: ${repliesFixed}`);
    for (const [move, count] of Object.entries(replyMoves)) {
      push(`  ${move}: ${count} replies`);
    }
    if (repliesNoMatch > 0) {
      push(`  (${repliesNoMatch} replies had campaign_id not found in any agent's campaigns)`);
    }

    // ---------------------------------------------------------------
    // 5. Fix agent_id on interested_leads
    //    Match by: lead's reply campaign_id OR lead_email match to a reply
    // ---------------------------------------------------------------
    let leadsFixed = 0;
    const leadMoves: Record<string, number> = {};

    // Build email → correct agent mapping from the already-fixed replies
    const emailToAgent = new Map<string, string>();
    for (const reply of allReplies) {
      const campaignId = reply.emailbison_campaign_id?.toString();
      if (!campaignId) continue;
      const correctAgentId = campaignToAgent.get(campaignId);
      if (correctAgentId) {
        emailToAgent.set(reply.lead_email.toLowerCase(), correctAgentId);
      }
    }

    for (const lead of allLeads) {
      // Strategy 1: Match by lead_metadata.id → find corresponding reply
      const correctAgentId = emailToAgent.get(lead.lead_email.toLowerCase());

      if (correctAgentId && lead.agent_id !== correctAgentId) {
        const oldAgent = agentById.get(lead.agent_id);
        const newAgent = agentById.get(correctAgentId);
        const key = `"${oldAgent?.name}" → "${newAgent?.name}"`;
        leadMoves[key] = (leadMoves[key] || 0) + 1;

        if (!dryRun) {
          await updateInterestedLead(lead.id, {
            agent_id: correctAgentId,
          } as any);
        }
        leadsFixed++;
      }
    }

    push(`\nLeads re-assigned: ${leadsFixed}`);
    for (const [move, count] of Object.entries(leadMoves)) {
      push(`  ${move}: ${count} leads`);
    }

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    const summary = {
      dry_run: dryRun,
      agents_count: agents.length,
      emailbison_agents: emailbisonAgents.length,
      campaign_mappings: campaignToAgent.size,
      replies_checked: allReplies.length,
      replies_reassigned: repliesFixed,
      replies_no_campaign_match: repliesNoMatch,
      leads_checked: allLeads.length,
      leads_reassigned: leadsFixed,
    };

    push(`\n=== DONE === ${JSON.stringify(summary)}`);

    return NextResponse.json({
      success: true,
      summary,
      agent_campaigns: Object.fromEntries(
        [...agentCampaignCounts].map(([agentId, count]) => [
          agentById.get(agentId)?.name || agentId,
          count,
        ])
      ),
      log,
    });
  } catch (error: any) {
    console.error('[FixAgents] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Migration failed',
        log,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/migrate/fix-agents
 * Preview what the migration would do (equivalent to dry_run=true)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.searchParams.set('dry_run', 'true');
  const previewRequest = new NextRequest(url, { method: 'POST' });
  return POST(previewRequest);
}
