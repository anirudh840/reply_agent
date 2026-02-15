import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAgents,
  getReplies,
  getInterestedLeads,
  updateReply,
  updateInterestedLead,
} from '@/lib/supabase/queries';
import { createClientForAgent } from '@/lib/platforms';
import { EmailBisonClient } from '@/lib/platforms/emailbison';
import { parseEmailThread } from '@/lib/utils/email-parser';
import type { ConversationMessage, Agent, Reply } from '@/lib/types';

/**
 * POST /api/migrate/fix-threads
 *
 * One-time migration that:
 * 1. Fixes agent_id mismatches on replies & interested_leads
 *    (caused by the legacy /api/webhooks/emailbison endpoint always using
 *     the first active agent instead of matching by workspace_id).
 * 2. Re-builds every interested_lead's conversation_thread so that each
 *    message is a separate card instead of one big blob with inline quotes.
 *
 * Pass ?dry_run=true to preview changes without writing anything.
 */
export async function POST(request: NextRequest) {
  const dryRun =
    request.nextUrl.searchParams.get('dry_run') === 'true';

  const log: string[] = [];
  const push = (msg: string) => {
    console.log(`[Migration] ${msg}`);
    log.push(msg);
  };

  try {
    push(dryRun ? '=== DRY RUN ===' : '=== LIVE RUN ===');

    // ---------------------------------------------------------------
    // 1. Load agents and index them by workspace_id
    // ---------------------------------------------------------------
    const agents = await getAllAgents();
    const agentById = new Map<string, Agent>();
    const agentByWorkspace = new Map<string, Agent>();

    for (const agent of agents) {
      agentById.set(agent.id, agent);
      if (agent.emailbison_workspace_id) {
        agentByWorkspace.set(agent.emailbison_workspace_id, agent);
      }
    }

    push(
      `Loaded ${agents.length} agents: ${agents.map((a) => `${a.name} (ws:${a.emailbison_workspace_id || 'none'}, platform:${a.platform || 'emailbison'})`).join(', ')}`
    );

    // ---------------------------------------------------------------
    // 2. Fix agent_id mismatches on replies table
    // ---------------------------------------------------------------
    const { data: allReplies } = await getReplies({ limit: 1000 });
    push(`Found ${allReplies.length} replies to check`);

    let repliesFixed = 0;

    for (const reply of allReplies) {
      const currentAgent = agentById.get(reply.agent_id);
      if (!currentAgent) {
        push(`  WARN: Reply ${reply.id} references unknown agent ${reply.agent_id}`);
        continue;
      }

      // Try to determine the correct agent from lead_metadata
      const replyWorkspaceId =
        reply.lead_metadata?.reply_raw?.workspace_id?.toString() ||
        reply.lead_metadata?.event_type === 'LEAD_REPLIED'
          ? reply.lead_metadata?.workspace_id?.toString()
          : undefined;

      // Also check campaign data embedded in lead_metadata
      const replyEventWorkspace =
        reply.lead_metadata?.campaign?.workspace_id?.toString();

      const wsId = replyWorkspaceId || replyEventWorkspace;

      if (wsId && agentByWorkspace.has(wsId)) {
        const correctAgent = agentByWorkspace.get(wsId)!;
        if (correctAgent.id !== reply.agent_id) {
          push(
            `  FIX reply ${reply.id}: ${reply.lead_email} — agent "${currentAgent.name}" → "${correctAgent.name}" (workspace ${wsId})`
          );
          if (!dryRun) {
            await updateReply(reply.id, { agent_id: correctAgent.id } as any);
          }
          repliesFixed++;
        }
      }
    }

    push(`Replies agent_id fixed: ${repliesFixed}`);

    // ---------------------------------------------------------------
    // 3. Fix agent_id mismatches on interested_leads table
    //    and rebuild conversation threads
    // ---------------------------------------------------------------
    const { data: allLeads } = await getInterestedLeads({ limit: 1000 });
    push(`Found ${allLeads.length} interested_leads to process`);

    let leadsFixed = 0;
    let threadsRebuilt = 0;

    for (const lead of allLeads) {
      const currentAgent = agentById.get(lead.agent_id);
      if (!currentAgent) {
        push(`  WARN: Lead ${lead.id} references unknown agent ${lead.agent_id}`);
        continue;
      }

      // ---- Fix agent_id ----
      // Check lead_metadata for workspace info
      const leadWorkspaceId =
        lead.lead_metadata?.reply_raw?.workspace_id?.toString() ||
        lead.lead_metadata?.workspace_id?.toString();

      let correctAgent = currentAgent;

      if (leadWorkspaceId && agentByWorkspace.has(leadWorkspaceId)) {
        const matched = agentByWorkspace.get(leadWorkspaceId)!;
        if (matched.id !== lead.agent_id) {
          push(
            `  FIX lead ${lead.id}: ${lead.lead_email} — agent "${currentAgent.name}" → "${matched.name}" (workspace ${leadWorkspaceId})`
          );
          correctAgent = matched;
          if (!dryRun) {
            await updateInterestedLead(lead.id, {
              agent_id: matched.id,
            } as any);
          }
          leadsFixed++;
        }
      }

      // ---- Rebuild conversation thread ----
      // Try to fetch the full thread from the platform API
      const leadId =
        lead.lead_metadata?.id?.toString() ||
        lead.lead_metadata?.reply_raw?.lead_id?.toString();
      const platform = correctAgent.platform || 'emailbison';

      let newThread: ConversationMessage[] = [];
      let source = 'none';

      // Strategy 1: Fetch from platform API
      if (leadId && platform === 'emailbison') {
        try {
          const client = createClientForAgent(correctAgent);
          if (client instanceof EmailBisonClient) {
            const apiReplies = await client.getRepliesByLeadId(leadId);

            if (apiReplies.length > 0) {
              source = 'api';

              // Sort chronologically (oldest first)
              const sorted = [...apiReplies].sort(
                (a, b) =>
                  new Date(a.received_at).getTime() -
                  new Date(b.received_at).getTime()
              );

              for (const apiReply of sorted) {
                // Parse to strip quoted text — keep only the newest part
                const parsed = parseEmailThread(apiReply.body);
                const content =
                  parsed.length > 0 ? parsed[0].content : apiReply.body;

                newThread.push({
                  role: 'lead',
                  content,
                  timestamp: apiReply.received_at,
                  emailbison_message_id: apiReply.id,
                  from: apiReply.from_name || apiReply.from_email,
                });
              }

              push(
                `  THREAD lead ${lead.id} (${lead.lead_email}): fetched ${apiReplies.length} messages from API`
              );
            }
          }
        } catch (err: any) {
          push(
            `  WARN: API fetch failed for lead ${lead.id}: ${err.message}`
          );
        }
      }

      // Strategy 2: Parse the existing thread's raw text
      if (newThread.length === 0 && lead.conversation_thread.length > 0) {
        source = 'parse';

        for (const msg of lead.conversation_thread) {
          const parsed = parseEmailThread(msg.content);

          if (parsed.length > 1) {
            // The message contained quoted text — split it
            for (const pm of parsed) {
              newThread.push({
                role: pm.isQuoted ? 'agent' : msg.role,
                content: pm.content,
                timestamp: pm.date || msg.timestamp,
                emailbison_message_id: pm.isQuoted
                  ? undefined
                  : msg.emailbison_message_id,
                is_quoted: pm.isQuoted,
                from: pm.from || (pm.isQuoted ? undefined : msg.from),
              });
            }
          } else {
            // Already a clean single message
            newThread.push(msg);
          }
        }

        push(
          `  THREAD lead ${lead.id} (${lead.lead_email}): parsed ${lead.conversation_thread.length} → ${newThread.length} messages`
        );
      }

      // Also re-insert any agent outbound messages from the old thread
      // that the API wouldn't know about
      if (source === 'api') {
        const existingAgentMessages = lead.conversation_thread.filter(
          (m) => m.role === 'agent' && !m.is_quoted
        );
        for (const agentMsg of existingAgentMessages) {
          // Only add if not already in the new thread
          const exists = newThread.some(
            (m) =>
              m.role === 'agent' &&
              m.emailbison_message_id === agentMsg.emailbison_message_id
          );
          if (!exists) {
            newThread.push(agentMsg);
          }
        }
        // Re-sort after merging
        newThread.sort(
          (a, b) =>
            new Date(a.timestamp).getTime() -
            new Date(b.timestamp).getTime()
        );
      }

      // Write the rebuilt thread if it changed
      if (
        newThread.length > 0 &&
        JSON.stringify(newThread) !==
          JSON.stringify(lead.conversation_thread)
      ) {
        if (!dryRun) {
          await updateInterestedLead(lead.id, {
            conversation_thread: newThread,
          });
        }
        threadsRebuilt++;
      }
    }

    push(`Leads agent_id fixed: ${leadsFixed}`);
    push(`Threads rebuilt: ${threadsRebuilt}`);

    // ---------------------------------------------------------------
    // Summary
    // ---------------------------------------------------------------
    const summary = {
      dry_run: dryRun,
      agents_count: agents.length,
      replies_checked: allReplies.length,
      replies_agent_fixed: repliesFixed,
      leads_checked: allLeads.length,
      leads_agent_fixed: leadsFixed,
      threads_rebuilt: threadsRebuilt,
    };

    push(`\n=== DONE === ${JSON.stringify(summary)}`);

    return NextResponse.json({
      success: true,
      summary,
      log,
    });
  } catch (error: any) {
    console.error('[Migration] Error:', error);
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
 * GET /api/migrate/fix-threads
 * Preview what the migration would do (equivalent to dry_run=true)
 */
export async function GET(request: NextRequest) {
  // Redirect to POST with dry_run
  const url = new URL(request.url);
  url.searchParams.set('dry_run', 'true');

  // Call POST internally
  const previewRequest = new NextRequest(url, { method: 'POST' });
  return POST(previewRequest);
}
