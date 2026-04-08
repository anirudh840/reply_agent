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
 * DISABLED — This legacy endpoint has been shut down to prevent cross-workspace
 * reply routing. It previously contained a dangerous fallback that could route
 * replies from one workspace to the wrong agent.
 *
 * All EmailBison workspaces MUST use agent-specific webhook URLs:
 *   /api/webhooks/{agent_webhook_id}
 *
 * Use GET /api/webhooks/emailbison to see available agent webhook URLs.
 */
export async function POST(request: NextRequest) {
  // Log the attempt so we can identify which workspaces still point here
  try {
    const payload = await request.json();
    const payloadWorkspaceId = payload?.event?.workspace_id;
    const payloadWorkspaceName = payload?.event?.workspace_name;
    const fromEmail = payload?.data?.reply?.from_email_address || payload?.data?.lead?.email;

    console.error(
      `[Webhook/Legacy] BLOCKED: Legacy endpoint received a webhook that was rejected. ` +
        `workspace_id=${payloadWorkspaceId}, workspace_name="${payloadWorkspaceName}", ` +
        `from=${fromEmail}. ` +
        `This workspace must be reconfigured to use an agent-specific webhook URL. ` +
        `See GET /api/webhooks/emailbison for available URLs.`
    );
  } catch {
    console.error('[Webhook/Legacy] BLOCKED: Legacy endpoint received an unparseable webhook.');
  }

  // Return available agent webhook URLs to help with reconfiguration
  try {
    const agents = await getAllAgents();
    const activeAgents = agents.filter((a) => a.is_active);

    return NextResponse.json(
      {
        success: false,
        error:
          'This legacy webhook endpoint has been disabled to prevent cross-workspace reply routing. ' +
          'Please update your EmailBison workspace webhook URL to the agent-specific URL listed below.',
        available_agents: activeAgents.map((a) => ({
          name: a.name,
          platform: a.platform || 'emailbison',
          workspace_id: a.emailbison_workspace_id,
          webhook_url: a.webhook_id
            ? getWebhookUrl(a.webhook_id)
            : 'No webhook_id assigned',
        })),
      },
      { status: 410 } // 410 Gone
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        error:
          'This legacy webhook endpoint has been disabled. ' +
          'Use agent-specific webhook URLs instead. ' +
          'See GET /api/webhooks/emailbison for available URLs.',
      },
      { status: 410 }
    );
  }
}
