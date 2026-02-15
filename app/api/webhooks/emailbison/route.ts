import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents } from '@/lib/supabase/queries';
import { getWebhookUrl } from '@/lib/webhooks';

/**
 * GET /api/webhooks/emailbison
 * Test endpoint to verify webhook is accessible
 */
export async function GET(request: NextRequest) {
  // Show available agent webhook URLs to help with debugging
  try {
    const agents = await getAllAgents();
    const activeAgents = agents.filter((a) => a.is_active);

    return NextResponse.json({
      success: true,
      message:
        'DEPRECATED: This is a legacy endpoint. Use agent-specific webhook URLs instead.',
      note: 'Each agent has its own webhook URL. Configure these in your platform settings.',
      agents: activeAgents.map((a) => ({
        name: a.name,
        platform: a.platform || 'emailbison',
        workspace_id: a.emailbison_workspace_id,
        webhook_url: a.webhook_id ? getWebhookUrl(a.webhook_id) : 'No webhook_id assigned',
      })),
      timestamp: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({
      success: true,
      message: 'EmailBison webhook endpoint is active (legacy)',
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * POST /api/webhooks/emailbison
 * LEGACY webhook endpoint - routes to the correct agent by matching workspace_id.
 *
 * THIS IS A COMPATIBILITY SHIM. New agents should use their dedicated
 * webhook URL: /api/webhooks/{agent_webhook_id}
 *
 * Previously this endpoint blindly used activeAgents[0], causing replies
 * from one workspace to be attributed to the wrong agent.
 */
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    console.log(
      '[Webhook/Legacy] Received payload on legacy /api/webhooks/emailbison endpoint'
    );

    // Validate webhook payload
    if (!payload || !payload.event || payload.event.type !== 'LEAD_REPLIED') {
      console.log('[Webhook/Legacy] Invalid event type:', payload?.event?.type);
      return NextResponse.json(
        {
          success: false,
          error: `Invalid webhook event type: ${payload?.event?.type || 'unknown'}. Expected LEAD_REPLIED.`,
        },
        { status: 400 }
      );
    }

    // Extract workspace_id from payload for agent matching
    const payloadWorkspaceId = payload.event?.workspace_id?.toString();
    const payloadWorkspaceName = payload.event?.workspace_name;

    console.log(
      `[Webhook/Legacy] Payload workspace: id=${payloadWorkspaceId}, name="${payloadWorkspaceName}"`
    );

    // Get all agents and find the correct one
    const agents = await getAllAgents();
    const activeEmailBisonAgents = agents.filter(
      (a) => a.is_active && (!a.platform || a.platform === 'emailbison')
    );

    if (activeEmailBisonAgents.length === 0) {
      console.error('[Webhook/Legacy] No active EmailBison agents found');
      return NextResponse.json(
        {
          success: false,
          error: 'No active EmailBison agents configured',
        },
        { status: 400 }
      );
    }

    // Match agent by workspace_id
    let matchedAgent = null;

    if (payloadWorkspaceId) {
      matchedAgent = activeEmailBisonAgents.find(
        (a) => a.emailbison_workspace_id === payloadWorkspaceId
      );

      if (matchedAgent) {
        console.log(
          `[Webhook/Legacy] Matched agent by workspace_id: ${matchedAgent.name} (${matchedAgent.id})`
        );
      }
    }

    // If no match by workspace_id, warn loudly and try single-agent fallback
    if (!matchedAgent) {
      if (activeEmailBisonAgents.length === 1) {
        matchedAgent = activeEmailBisonAgents[0];
        console.warn(
          `[Webhook/Legacy] Could not match workspace_id "${payloadWorkspaceId}". ` +
            `Only one active EmailBison agent exists, using: ${matchedAgent.name} (${matchedAgent.id}). ` +
            `Consider configuring the agent-specific webhook URL instead.`
        );
      } else {
        // CRITICAL: Do NOT blindly pick the first agent when there are multiple
        console.error(
          `[Webhook/Legacy] ROUTING ERROR: Could not match workspace_id "${payloadWorkspaceId}" ` +
            `to any of ${activeEmailBisonAgents.length} active EmailBison agents. ` +
            `Agents: ${activeEmailBisonAgents.map((a) => `${a.name} (ws:${a.emailbison_workspace_id})`).join(', ')}. ` +
            `Payload workspace: id=${payloadWorkspaceId}, name="${payloadWorkspaceName}". ` +
            `Please use agent-specific webhook URLs to fix this.`
        );

        return NextResponse.json(
          {
            success: false,
            error:
              'Could not determine which agent this webhook belongs to. ' +
              `Payload workspace_id "${payloadWorkspaceId}" does not match any agent. ` +
              'Please use the agent-specific webhook URL instead of this legacy endpoint. ' +
              'Check GET /api/webhooks/emailbison to see available webhook URLs.',
            available_agents: activeEmailBisonAgents.map((a) => ({
              name: a.name,
              workspace_id: a.emailbison_workspace_id,
              webhook_url: a.webhook_id
                ? getWebhookUrl(a.webhook_id)
                : 'No webhook_id',
            })),
          },
          { status: 400 }
        );
      }
    }

    // Forward to the agent's dedicated webhook handler
    // Reconstruct the request and forward it to the dynamic endpoint
    if (matchedAgent.webhook_id) {
      const webhookUrl = getWebhookUrl(matchedAgent.webhook_id);
      console.log(
        `[Webhook/Legacy] Forwarding to agent-specific webhook: ${webhookUrl}`
      );

      // Build internal URL for forwarding
      const internalUrl = new URL(
        `/api/webhooks/${matchedAgent.webhook_id}`,
        request.url
      );

      const forwardResponse = await fetch(internalUrl.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await forwardResponse.json();

      return NextResponse.json(
        {
          ...result,
          _routed_via: 'legacy_endpoint',
          _matched_agent: matchedAgent.name,
          _recommendation: `Configure your webhook URL to: ${webhookUrl}`,
        },
        { status: forwardResponse.status }
      );
    }

    // Agent has no webhook_id (very old agent) - fail gracefully
    console.error(
      `[Webhook/Legacy] Agent "${matchedAgent.name}" has no webhook_id. ` +
        'Please visit /api/agents/migrate-webhooks to fix this.'
    );

    return NextResponse.json(
      {
        success: false,
        error: `Agent "${matchedAgent.name}" has no webhook_id configured. ` +
          'Please visit /api/agents/migrate-webhooks to assign one.',
      },
      { status: 500 }
    );
  } catch (error: any) {
    console.error('[Webhook/Legacy] Error processing webhook:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to process webhook',
      },
      { status: 500 }
    );
  }
}
