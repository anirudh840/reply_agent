import { NextRequest, NextResponse } from 'next/server';
import { getAgent } from '@/lib/supabase/queries';
import { createBookingClient, getAvailabilityContext } from '@/lib/integrations/booking';

/**
 * GET /api/debug/test-availability?agent_id=xxx
 * Test calendar availability fetching for an agent.
 * Returns raw slots and formatted context string.
 */
export async function GET(request: NextRequest) {
  try {
    const agentId = request.nextUrl.searchParams.get('agent_id');

    if (!agentId) {
      return NextResponse.json(
        { success: false, error: 'agent_id query parameter is required' },
        { status: 400 }
      );
    }

    const agent = await getAgent(agentId);

    // Check booking configuration
    const bookingConfig = {
      booking_platform: agent.booking_platform || null,
      booking_api_key: agent.booking_api_key ? '***configured***' : null,
      booking_event_id: agent.booking_event_id || null,
      booking_link: agent.booking_link || null,
    };

    if (!agent.booking_platform || !agent.booking_api_key || !agent.booking_event_id) {
      return NextResponse.json({
        success: false,
        error: 'Agent does not have complete booking configuration',
        booking_config: bookingConfig,
      });
    }

    // Fetch raw slots
    const client = createBookingClient(agent);
    if (!client) {
      return NextResponse.json({
        success: false,
        error: 'Failed to create booking client',
        booking_config: bookingConfig,
      });
    }

    const rawSlots = await client.getAvailableSlots(7);

    // Get the formatted context string (same as what goes into AI prompt)
    const formattedContext = await getAvailabilityContext(agent);

    return NextResponse.json({
      success: true,
      agent_name: agent.name,
      booking_config: bookingConfig,
      raw_slots: rawSlots,
      slot_count: rawSlots.length,
      formatted_context: formattedContext,
      booking_link: client.getBookingLink(),
    });
  } catch (error: any) {
    console.error('[DebugAvailability] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to test availability',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
