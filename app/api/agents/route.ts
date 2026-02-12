import { NextRequest, NextResponse } from 'next/server';
import { createAgent, getAgents } from '@/lib/supabase/queries';
import { generateKnowledgeBaseEmbeddings } from '@/lib/openai/embeddings';
import { createEmailBisonClient } from '@/lib/emailbison/client';
import { createOpenAIClient } from '@/lib/openai/client';
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
    if (!body.name || !body.emailbison_api_key || !body.openai_api_key) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: name, emailbison_api_key, openai_api_key',
        },
        { status: 400 }
      );
    }

    // Test EmailBison API connection
    try {
      const emailbisonClient = createEmailBisonClient(body.emailbison_api_key);
      const isValidEmailBison = await emailbisonClient.testConnection();

      if (!isValidEmailBison) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid EmailBison API key',
          },
          { status: 400 }
        );
      }
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to connect to EmailBison API. Please check your API key.',
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

    // Create agent in database
    const agentData: Omit<Agent, 'id' | 'created_at' | 'updated_at'> = {
      name: body.name,
      mode: body.mode || 'human_in_loop',
      timezone: body.timezone || 'UTC',
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

    return NextResponse.json(
      {
        success: true,
        data: agent,
        message: 'Agent created successfully. Generating knowledge base embeddings...',
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
