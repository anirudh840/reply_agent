import { NextRequest, NextResponse } from 'next/server';
import { CalComClient } from '@/lib/integrations/calcom';
import { CalendlyClient } from '@/lib/integrations/calendly';

/**
 * POST /api/integrations/booking/event-types
 * Fetch event types from Cal.com or Calendly using the provided API key
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { booking_platform, booking_api_key } = body;

    if (!booking_platform || !booking_api_key) {
      return NextResponse.json(
        { success: false, error: 'booking_platform and booking_api_key are required' },
        { status: 400 }
      );
    }

    if (booking_platform === 'cal_com') {
      const client = new CalComClient(booking_api_key);

      try {
        const eventTypes = await client.getEventTypes();

        return NextResponse.json({
          success: true,
          data: eventTypes.map((et) => ({
            id: et.id.toString(),
            name: et.title,
            duration: et.length,
            booking_url: undefined, // Cal.com booking link is generated per event
          })),
        });
      } catch (calError: any) {
        console.error('[Booking] Cal.com error:', calError.message);
        return NextResponse.json(
          { success: false, error: `Cal.com error: ${calError.message}` },
          { status: 400 }
        );
      }
    }

    if (booking_platform === 'calendly') {
      const client = new CalendlyClient(booking_api_key);

      try {
        const eventTypes = await client.getEventTypes();

        return NextResponse.json({
          success: true,
          data: eventTypes.map((et) => ({
            id: et.uri,
            name: et.name,
            duration: et.duration,
            booking_url: et.scheduling_url,
          })),
        });
      } catch (calendlyError: any) {
        console.error('[Booking] Calendly error:', calendlyError.message);
        return NextResponse.json(
          { success: false, error: `Calendly error: ${calendlyError.message}` },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      { success: false, error: `Unsupported booking platform: ${booking_platform}` },
      { status: 400 }
    );
  } catch (error: any) {
    console.error('[Booking] Error fetching event types:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch event types' },
      { status: 500 }
    );
  }
}
