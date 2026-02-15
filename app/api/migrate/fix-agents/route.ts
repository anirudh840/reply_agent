import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAgents,
  getReplies,
  getInterestedLeads,
  updateAgent,
  updateReply,
  updateInterestedLead,
} from '@/lib/supabase/queries';
import type { Agent, Reply, InterestedLead } from '@/lib/types';

/**
 * POST /api/migrate/fix-agents
 *
 * Intelligent migration that:
 * 1. Scans all replies & interested_leads to extract workspace_ids from lead_metadata
 * 2. Auto-populates the `emailbison_workspace_id` field on agents
 * 3. Re-assigns replies & interested_leads to the correct agent based on workspace_id
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
              `  - "${a.name}" (id: ${a.id}, platform: ${a.platform || 'emailbison'}, workspace_id: ${a.emailbison_workspace_id || 'NULL'})`
          )
          .join('\n')
    );

    // ---------------------------------------------------------------
    // 2. Extract workspace_ids from all replies and interested_leads
    // ---------------------------------------------------------------
    const { data: allReplies } = await getReplies({ limit: 1000 });
    const { data: allLeads } = await getInterestedLeads({ limit: 1000 });

    push(`Found ${allReplies.length} replies and ${allLeads.length} interested_leads`);

    // Map: workspace_id -> { agent_ids: Set, reply_count, lead_count, lead_emails }
    const workspaceMap = new Map<
      string,
      {
        agent_ids: Set<string>;
        reply_count: number;
        lead_count: number;
        lead_emails: Set<string>;
      }
    >();

    function trackWorkspace(wsId: string, agentId: string, type: 'reply' | 'lead', email?: string) {
      if (!workspaceMap.has(wsId)) {
        workspaceMap.set(wsId, {
          agent_ids: new Set(),
          reply_count: 0,
          lead_count: 0,
          lead_emails: new Set(),
        });
      }
      const entry = workspaceMap.get(wsId)!;
      entry.agent_ids.add(agentId);
      if (type === 'reply') entry.reply_count++;
      if (type === 'lead') entry.lead_count++;
      if (email) entry.lead_emails.add(email);
    }

    // Extract workspace_ids from lead_metadata in various nested locations
    function extractWorkspaceId(metadata: Record<string, any>): string | undefined {
      return (
        metadata?.reply_raw?.workspace_id?.toString() ||
        metadata?.workspace_id?.toString() ||
        metadata?.campaign?.workspace_id?.toString() ||
        metadata?.event?.workspace_id?.toString() ||
        // Also check data.reply.workspace_id pattern (direct webhook payload storage)
        metadata?.data?.reply?.workspace_id?.toString() ||
        metadata?.data?.campaign?.workspace_id?.toString()
      );
    }

    for (const reply of allReplies) {
      const wsId = extractWorkspaceId(reply.lead_metadata || {});
      if (wsId) {
        trackWorkspace(wsId, reply.agent_id, 'reply', reply.lead_email);
      }
    }

    for (const lead of allLeads) {
      const wsId = extractWorkspaceId(lead.lead_metadata || {});
      if (wsId) {
        trackWorkspace(wsId, lead.agent_id, 'lead', lead.lead_email);
      }
    }

    push(`\nDiscovered ${workspaceMap.size} unique workspace_id(s):`);
    for (const [wsId, info] of workspaceMap) {
      const agentNames = [...info.agent_ids].map(
        (id) => agentById.get(id)?.name || id
      );
      push(
        `  workspace "${wsId}": ${info.reply_count} replies, ${info.lead_count} leads, ` +
          `currently assigned to agents: [${agentNames.join(', ')}], ` +
          `emails: [${[...info.lead_emails].slice(0, 5).join(', ')}${info.lead_emails.size > 5 ? '...' : ''}]`
      );
    }

    // ---------------------------------------------------------------
    // 3. Determine correct workspace → agent mapping
    //    Strategy: For EmailBison platform agents, assign workspace_ids
    //    found in the data. If only one EmailBison agent exists, it gets
    //    all EmailBison workspace_ids.
    // ---------------------------------------------------------------
    const emailbisonAgents = agents.filter(
      (a) => (a.platform || 'emailbison') === 'emailbison'
    );
    const nonEmailbisonAgents = agents.filter(
      (a) => a.platform && a.platform !== 'emailbison'
    );

    push(
      `\nEmailBison agents: [${emailbisonAgents.map((a) => a.name).join(', ')}]`
    );
    push(
      `Non-EmailBison agents: [${nonEmailbisonAgents.map((a) => `${a.name} (${a.platform})`).join(', ')}]`
    );

    // Build the mapping: workspace_id -> correct agent_id
    const workspaceToAgent = new Map<string, string>();
    let agentsUpdated = 0;

    if (emailbisonAgents.length === 1 && workspaceMap.size > 0) {
      // Simple case: only one EmailBison agent, it owns all EmailBison workspace_ids
      const agent = emailbisonAgents[0];
      for (const wsId of workspaceMap.keys()) {
        workspaceToAgent.set(wsId, agent.id);
      }

      if (!agent.emailbison_workspace_id) {
        // Set the first workspace_id on the agent
        const firstWsId = [...workspaceMap.keys()][0];
        push(`\n  SET workspace_id on "${agent.name}": ${firstWsId}`);
        if (!dryRun) {
          await updateAgent(agent.id, {
            emailbison_workspace_id: firstWsId,
          } as any);
        }
        agentsUpdated++;
      }
    } else if (emailbisonAgents.length > 1) {
      // Multiple EmailBison agents - try to match by existing workspace_id first
      for (const agent of emailbisonAgents) {
        if (agent.emailbison_workspace_id) {
          workspaceToAgent.set(agent.emailbison_workspace_id, agent.id);
        }
      }

      // For workspace_ids not yet assigned, try to determine correct agent
      // by looking at which agent name appears in campaign metadata
      for (const [wsId, info] of workspaceMap) {
        if (workspaceToAgent.has(wsId)) continue;

        // If this workspace is currently assigned to a non-EmailBison agent,
        // it probably belongs to one of the EmailBison agents
        const assignedToNonEB = [...info.agent_ids].some((id) =>
          nonEmailbisonAgents.some((a) => a.id === id)
        );

        if (assignedToNonEB && emailbisonAgents.length === 1) {
          // Only one EmailBison agent - it must own this workspace
          workspaceToAgent.set(wsId, emailbisonAgents[0].id);
          push(
            `  INFERRED: workspace "${wsId}" belongs to "${emailbisonAgents[0].name}" ` +
              `(currently misassigned to non-EmailBison agent)`
          );
        } else {
          // Multiple EB agents and we can't auto-determine
          push(
            `  AMBIGUOUS: workspace "${wsId}" cannot be auto-assigned ` +
              `(${emailbisonAgents.length} EmailBison agents, need manual input)`
          );
        }
      }

      // Set workspace_id on agents that don't have one yet
      for (const [wsId, agentId] of workspaceToAgent) {
        const agent = agentById.get(agentId)!;
        if (!agent.emailbison_workspace_id) {
          push(`  SET workspace_id on "${agent.name}": ${wsId}`);
          if (!dryRun) {
            await updateAgent(agent.id, {
              emailbison_workspace_id: wsId,
            } as any);
          }
          agentsUpdated++;
        }
      }
    }

    push(`\nWorkspace → Agent mapping:`);
    for (const [wsId, agentId] of workspaceToAgent) {
      push(`  workspace "${wsId}" → "${agentById.get(agentId)?.name}"`);
    }

    // ---------------------------------------------------------------
    // 4. Fix agent_id on replies based on workspace mapping
    // ---------------------------------------------------------------
    let repliesFixed = 0;

    for (const reply of allReplies) {
      const wsId = extractWorkspaceId(reply.lead_metadata || {});
      if (!wsId || !workspaceToAgent.has(wsId)) continue;

      const correctAgentId = workspaceToAgent.get(wsId)!;
      if (reply.agent_id !== correctAgentId) {
        const oldAgent = agentById.get(reply.agent_id);
        const newAgent = agentById.get(correctAgentId);
        push(
          `  FIX reply ${reply.id}: ${reply.lead_email} — ` +
            `"${oldAgent?.name}" → "${newAgent?.name}"`
        );
        if (!dryRun) {
          await updateReply(reply.id, { agent_id: correctAgentId } as any);
        }
        repliesFixed++;
      }
    }

    push(`\nReplies re-assigned: ${repliesFixed}`);

    // ---------------------------------------------------------------
    // 5. Fix agent_id on interested_leads based on workspace mapping
    // ---------------------------------------------------------------
    let leadsFixed = 0;

    for (const lead of allLeads) {
      const wsId = extractWorkspaceId(lead.lead_metadata || {});
      if (!wsId || !workspaceToAgent.has(wsId)) continue;

      const correctAgentId = workspaceToAgent.get(wsId)!;
      if (lead.agent_id !== correctAgentId) {
        const oldAgent = agentById.get(lead.agent_id);
        const newAgent = agentById.get(correctAgentId);
        push(
          `  FIX lead ${lead.id}: ${lead.lead_email} — ` +
            `"${oldAgent?.name}" → "${newAgent?.name}"`
        );
        if (!dryRun) {
          await updateInterestedLead(lead.id, {
            agent_id: correctAgentId,
          } as any);
        }
        leadsFixed++;
      }
    }

    push(`Leads re-assigned: ${leadsFixed}`);

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    const summary = {
      dry_run: dryRun,
      agents_count: agents.length,
      workspace_ids_found: workspaceMap.size,
      agents_workspace_updated: agentsUpdated,
      replies_checked: allReplies.length,
      replies_reassigned: repliesFixed,
      leads_checked: allLeads.length,
      leads_reassigned: leadsFixed,
    };

    push(`\n=== DONE === ${JSON.stringify(summary)}`);

    return NextResponse.json({
      success: true,
      summary,
      workspace_mapping: Object.fromEntries(
        [...workspaceToAgent].map(([wsId, agentId]) => [
          wsId,
          { agent_id: agentId, agent_name: agentById.get(agentId)?.name },
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
