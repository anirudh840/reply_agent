import { NextRequest, NextResponse } from 'next/server';
import { createAgent, getAgents } from '@/lib/supabase/queries';
import { generateKnowledgeBaseEmbeddings } from '@/lib/openai/embeddings';
import { createPlatformClient, platformDisplayName } from '@/lib/platforms';
import type { PlatformType } from '@/lib/platforms/types';
import { createOpenAIClient } from '@/lib/openai/client';
import { generateWebhookId, getWebhookUrl } from '@/lib/webhooks';
import type { Agent } from '@/lib/types';

/**
 * GET /api/agents
 * List all agents
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const activeOnly = searchParams.get('active_only') !== 'false';

    const agents = await getAgents(activeOnly);

    return NextResponse.json({
      success: true,
      data: agents,
    });
  } catch (error: any) {
    console.error('Error fetching agents:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch agents',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/agents
 * Create a new agent
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const platform: PlatformType = body.platform || 'emailbison';
    if (!body.name || !body.emailbison_api_key || !body.openai_api_key) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: name, API key, openai_api_key',
        },
        { status: 400 }
      );
    }

    const displayName = platformDisplayName(platform);

    // Test platform API connection
    try {
      const platformClient = createPlatformClient(
        platform,
        body.emailbison_api_key,
        body.platform_instance_url
      );
      const isValidPlatform = await platformClient.testConnection();

      if (!isValidPlatform) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid ${displayName} API key`,
          },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to connect to ${displayName} API. Please check your API key.`,
        },
        { status: 400 }
      );
    }

    // Test OpenAI API connection
    try {
      const openaiClient = createOpenAIClient(body.openai_api_key);
      const isValidOpenAI = await openaiClient.testConnection();

      if (!isValidOpenAI) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid OpenAI API key',
          },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to connect to OpenAI API. Please check your API key.',
        },
        { status: 400 }
      );
    }

    // Generate unique webhook ID for this agent
    const webhookId = generateWebhookId();

    // Create agent in database
    const agentData: Omit<Agent, 'id' | 'created_at' | 'updated_at'> = {
      name: body.name,
      mode: body.mode || 'human_in_loop',
      timezone: body.timezone || 'UTC',
      platform,
      platform_instance_url: platform === 'emailbison' ? body.platform_instance_url : undefined,
      emailbison_api_key: body.emailbison_api_key,
      emailbison_workspace_id: body.emailbison_workspace_id,
      openai_api_key: body.openai_api_key,
      knowledge_base: body.knowledge_base || {},
      objection_handling: body.objection_handling || {},
      case_studies: body.case_studies || [],
      followup_sequence: body.followup_sequence || {
        type: 'default',
        steps: [
          { delay_days: 1, type: 'value_driven' },
          { delay_days: 3, type: 'value_driven' },
          { delay_days: 10, type: 'close_up' },
        ],
      },
      learned_patterns: [],
      confidence_threshold: body.confidence_threshold || 6.0,
      is_active: true,
      last_sync_at: undefined,
      webhook_id: webhookId,
      webhook_secret: undefined, // Can be added later for verification
    };

    const agent = await createAgent(agentData);

    // Generate embeddings for knowledge base (async, don't wait)
    if (
      agent.knowledge_base &&
      Object.keys(agent.knowledge_base).length > 0
    ) {
      generateKnowledgeBaseEmbeddings(agent).catch((error) => {
        console.error('Error generating embeddings:', error);
      });
    }

    // Generate webhook URL for the response
    const webhookUrl = getWebhookUrl(agent.webhook_id!);

    return NextResponse.json(
      {
        success: true,
        data: agent,
        webhook_url: webhookUrl,
        message: `Agent created successfully. Configure the webhook URL in your ${displayName} workspace.`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error creating agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to create agent',
      },
      { status: 500 }
    );
  }
}
