import { NextRequest, NextResponse } from 'next/server';
import { testSlackWebhook } from '@/lib/integrations/slack';

/**
 * POST /api/integrations/slack/test
 * Test a Slack incoming webhook URL by sending a test message
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { slack_webhook_url } = body;

    if (!slack_webhook_url) {
      return NextResponse.json(
        { success: false, error: 'slack_webhook_url is required' },
        { status: 400 }
      );
    }

    // Basic URL validation
    try {
      new URL(slack_webhook_url);
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    const result = await testSlackWebhook(slack_webhook_url);

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to test Slack webhook' },
      { status: 500 }
    );
  }
}
