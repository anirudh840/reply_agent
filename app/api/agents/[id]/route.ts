import { NextRequest, NextResponse } from 'next/server';
import { getAgent, updateAgent, deleteAgent } from '@/lib/supabase/queries';
import { generateKnowledgeBaseEmbeddings } from '@/lib/openai/embeddings';
import { getBookingWebhookUrl } from '@/lib/webhooks';
import { CalComClient } from '@/lib/integrations/calcom';
import { CalendlyClient } from '@/lib/integrations/calendly';

/**
 * GET /api/agents/[id]
 * Get a specific agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const agent = await getAgent(id);

    // Strip sensitive API keys from response — only expose boolean flags
    // indicating whether each key is configured.
    const { emailbison_api_key, openai_api_key, anthropic_api_key, booking_api_key, ...safeAgent } = agent;

    return NextResponse.json({
      success: true,
      data: {
        ...safeAgent,
        has_platform_key: !!emailbison_api_key,
        has_openai_key: !!openai_api_key,
        has_anthropic_key: !!anthropic_api_key,
        has_booking_key: !!booking_api_key,
      },
    });
  } catch (error: any) {
    console.error('Error fetching agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch agent',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/agents/[id]
 * Update an agent
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // ── Validation ──
    // Prevent empty strings from wiping API keys
    const sensitiveKeys = ['emailbison_api_key', 'openai_api_key', 'anthropic_api_key'] as const;
    for (const key of sensitiveKeys) {
      if (key in body && typeof body[key] === 'string' && body[key].trim() === '') {
        delete body[key]; // Treat empty string as "don't update"
      }
    }

    // Validate ai_provider / ai_model compatibility.
    // Only validate when the submitted model is actually being CHANGED from the
    // stored value. Otherwise an existing agent whose DB ai_model happens to
    // be a legacy/deprecated ID (e.g. "claude-sonnet-4-5-20250514" which the
    // client self-heals to the 0929 release) would fail every save — even
    // when the user is only editing an unrelated field like booking_platform.
    if (body.ai_provider || body.ai_model) {
      const current = await getAgent(id);
      const provider = body.ai_provider || current.ai_provider || 'openai';
      const model = body.ai_model;
      const modelChanged = model !== undefined && model !== current.ai_model;
      if (modelChanged) {
        const { AI_MODELS } = await import('@/lib/constants');
        if (model && !AI_MODELS[provider as keyof typeof AI_MODELS]?.some((m: { id: string }) => m.id === model)) {
          return NextResponse.json(
            { success: false, error: `Model "${model}" is not compatible with provider "${provider}"` },
            { status: 400 }
          );
        }
      }
    }

    // Prevent clearing workspace_id with empty string — use null explicitly
    if ('emailbison_workspace_id' in body && body.emailbison_workspace_id === '') {
      body.emailbison_workspace_id = null;
    }

    // Update agent
    const agent = await updateAgent(id, body);

    // If knowledge base was updated, regenerate embeddings
    if (body.knowledge_base || body.objection_handling || body.case_studies) {
      generateKnowledgeBaseEmbeddings(agent).catch((error) => {
        console.error('Error regenerating embeddings:', error);
      });
    }

    // Auto-register booking webhook if booking config was updated
    let bookingWebhookRegistered = false;
    const bookingConfigChanged = body.booking_platform || body.booking_api_key || body.booking_event_id;
    if (bookingConfigChanged && agent.booking_platform && agent.booking_api_key && agent.webhook_id) {
      try {
        const callbackUrl = getBookingWebhookUrl(agent.webhook_id);

        if (agent.booking_platform === 'calendly') {
          const client = new CalendlyClient(agent.booking_api_key);
          await client.createWebhookSubscription(callbackUrl);
          bookingWebhookRegistered = true;
        } else if (agent.booking_platform === 'cal_com') {
          const client = new CalComClient(agent.booking_api_key);
          await client.createWebhook(callbackUrl);
          bookingWebhookRegistered = true;
        }

        console.log(`[Agent Update] Auto-registered ${agent.booking_platform} booking webhook`);
      } catch (bookingWebhookError) {
        console.warn('[Agent Update] Failed to auto-register booking webhook:', bookingWebhookError);
      }
    }

    // Strip sensitive API keys from response
    const { emailbison_api_key, openai_api_key, anthropic_api_key, booking_api_key, ...safeAgent } = agent;

    return NextResponse.json({
      success: true,
      data: {
        ...safeAgent,
        has_platform_key: !!emailbison_api_key,
        has_openai_key: !!openai_api_key,
        has_anthropic_key: !!anthropic_api_key,
        has_booking_key: !!booking_api_key,
      },
      booking_webhook_registered: bookingWebhookRegistered,
      message: 'Agent updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update agent',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/agents/[id]
 * Delete an agent
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteAgent(id);

    return NextResponse.json({
      success: true,
      message: 'Agent deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting agent:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to delete agent',
      },
      { status: 500 }
    );
  }
}
