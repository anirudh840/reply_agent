import { NextRequest, NextResponse } from 'next/server';
import { getAllAgents, updateAgent } from '@/lib/supabase/queries';
import { generateWebhookId, getWebhookUrl } from '@/lib/webhooks';

/**
 * POST /api/agents/migrate-webhooks
 * Add webhook IDs to existing agents that don't have them
 */
export async function POST(request: NextRequest) {
  try {
    const agents = await getAllAgents();
    const agentsWithoutWebhooks = agents.filter((agent) => !agent.webhook_id);

    if (agentsWithoutWebhooks.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All agents already have webhooks configured',
        updated: 0,
      });
    }

    const results = [];

    for (const agent of agentsWithoutWebhooks) {
      const webhookId = generateWebhookId();

      await updateAgent(agent.id, {
        webhook_id: webhookId,
      });

      results.push({
        agent_id: agent.id,
        agent_name: agent.name,
        webhook_id: webhookId,
        webhook_url: getWebhookUrl(webhookId),
      });

      console.log(`[Migration] Added webhook to agent ${agent.name}: ${getWebhookUrl(webhookId)}`);
    }

    return NextResponse.json({
      success: true,
      message: `Successfully added webhooks to ${results.length} agents`,
      updated: results.length,
      agents: results,
    });
  } catch (error: any) {
    console.error('Error migrating webhooks:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to migrate webhooks',
      },
      { status: 500 }
    );
  }
}
