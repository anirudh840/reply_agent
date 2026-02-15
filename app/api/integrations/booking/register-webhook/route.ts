import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/supabase/queries';
import { getBookingWebhookUrl } from '@/lib/webhooks';
import { CalendlyClient } from '@/lib/integrations/calendly';
import { CalComClient } from '@/lib/integrations/calcom';

/**
 * POST /api/integrations/booking/register-webhook
 * Auto-register a booking webhook with Calendly or Cal.com.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_id, booking_platform, booking_api_key } = body;

    if (!agent_id || !booking_platform || !booking_api_key) {
      return NextResponse.json(
        { success: false, error: 'agent_id, booking_platform, and booking_api_key are required' },
        { status: 400 }
      );
    }

    const agent = await getAgent(agent_id);
    if (!agent.webhook_id) {
      return NextResponse.json(
        { success: false, error: 'Agent has no webhook_id configured' },
        { status: 400 }
      );
    }

    const callbackUrl = getBookingWebhookUrl(agent.webhook_id);

    let subscriptionId: string;

    if (booking_platform === 'calendly') {
      const client = new CalendlyClient(booking_api_key);
      const result = await client.createWebhookSubscription(callbackUrl);
      subscriptionId = result.webhookId;
    } else if (booking_platform === 'cal_com') {
      const client = new CalComClient(booking_api_key);
      const result = await client.createWebhook(callbackUrl);
      subscriptionId = result.webhookId;
    } else {
      return NextResponse.json(
        { success: false, error: `Unsupported platform: ${booking_platform}` },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      subscription_id: subscriptionId,
      webhook_url: callbackUrl,
    });
  } catch (error: any) {
    console.error('[RegisterBookingWebhook] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to register webhook' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/integrations/booking/register-webhook
 * Unregister a booking webhook from Calendly or Cal.com.
 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { booking_platform, booking_api_key, subscription_id } = body;

    if (!booking_platform || !booking_api_key || !subscription_id) {
      return NextResponse.json(
        { success: false, error: 'booking_platform, booking_api_key, and subscription_id are required' },
        { status: 400 }
      );
    }

    if (booking_platform === 'calendly') {
      const client = new CalendlyClient(booking_api_key);
      await client.deleteWebhookSubscription(subscription_id);
    } else if (booking_platform === 'cal_com') {
      const client = new CalComClient(booking_api_key);
      await client.deleteWebhook(subscription_id);
    } else {
      return NextResponse.json(
        { success: false, error: `Unsupported platform: ${booking_platform}` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[UnregisterBookingWebhook] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to unregister webhook' },
      { status: 500 }
    );
  }
}
