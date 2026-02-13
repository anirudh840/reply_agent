import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/supabase/queries';
import { getWebhookUrl } from '@/lib/webhooks';

/**
 * POST /api/agents/[id]/test-webhook
 * Test the webhook for a specific agent by sending a test payload
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Get the agent
    const agent = await getAgent(id);

    if (!agent.webhook_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Agent does not have a webhook configured',
        },
        { status: 400 }
      );
    }

    // Get the webhook URL
    const webhookUrl = getWebhookUrl(agent.webhook_id);

    // Create a test payload simulating EmailBison webhook
    const testPayload = {
      event: 'reply.received.test',
      reply: {
        id: 'test-' + Date.now(),
        from_email_address: 'test@example.com',
        from_name: 'Test User',
        subject: 'Test Reply - Webhook Verification',
        text_body: 'This is a test message to verify the webhook is working correctly.',
        html_body: '<p>This is a test message to verify the webhook is working correctly.</p>',
        date_received: new Date().toISOString(),
        interested: true,
        automated_reply: false,
        tracked_reply: false,
        campaign_id: 'test-campaign',
      },
    };

    // Send test webhook request
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(testPayload),
      });

      const responseData = await response.json();

      if (!response.ok) {
        return NextResponse.json({
          success: false,
          webhook_url: webhookUrl,
          test_result: 'failed',
          status_code: response.status,
          error: responseData.error || 'Webhook test failed',
          response: responseData,
        });
      }

      return NextResponse.json({
        success: true,
        webhook_url: webhookUrl,
        test_result: 'passed',
        status_code: response.status,
        message: 'Webhook is working correctly!',
        response: responseData,
      });
    } catch (fetchError: any) {
      return NextResponse.json(
        {
          success: false,
          webhook_url: webhookUrl,
          test_result: 'failed',
          error: `Failed to reach webhook: ${fetchError.message}`,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error testing webhook:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to test webhook',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/agents/[id]/test-webhook
 * Get webhook information for an agent
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // Get the agent
    const agent = await getAgent(id);

    if (!agent.webhook_id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Agent does not have a webhook configured',
        },
        { status: 400 }
      );
    }

    // Get the webhook URL
    const webhookUrl = getWebhookUrl(agent.webhook_id);

    return NextResponse.json({
      success: true,
      data: {
        webhook_id: agent.webhook_id,
        webhook_url: webhookUrl,
        agent_id: agent.id,
        agent_name: agent.name,
        is_active: agent.is_active,
      },
    });
  } catch (error: any) {
    console.error('Error getting webhook info:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get webhook information',
      },
      { status: 500 }
    );
  }
}
