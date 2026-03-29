import { NextRequest, NextResponse } from 'next/server';
import {
  getAllAgents,
  getInterestedLeadByEmail,
  findLeadsByEmailDomain,
  createMeetingBooked,
  updateInterestedLead,
} from '@/lib/supabase/queries';
import { sendMeetingAutoDetectedNotification } from '@/lib/integrations/slack';

interface NormalizedBookingEvent {
  attendeeEmail: string;
  attendeeName?: string;
  meetingTime?: string;
  meetingEndTime?: string;
  meetingUrl?: string;
  eventName?: string;
  platform: 'calendly' | 'cal_com';
}

/**
 * Detect platform and normalize the booking webhook payload.
 */
function normalizeBookingPayload(body: any): NormalizedBookingEvent | null {
  // Calendly: invitee.created
  if (body.event === 'invitee.created' && body.payload) {
    const invitee = body.payload.invitee || {};
    const event = body.payload.event || {};
    const eventType = body.payload.event_type || {};

    return {
      attendeeEmail: invitee.email || '',
      attendeeName: invitee.name,
      meetingTime: event.start_time,
      meetingEndTime: event.end_time,
      meetingUrl: event.location?.join_url,
      eventName: eventType.name,
      platform: 'calendly',
    };
  }

  // Cal.com: BOOKING_CREATED
  if (body.triggerEvent === 'BOOKING_CREATED' && body.payload) {
    const payload = body.payload;
    const attendee = payload.attendees?.[0] || {};

    return {
      attendeeEmail: attendee.email || '',
      attendeeName: attendee.name,
      meetingTime: payload.startTime,
      meetingEndTime: payload.endTime,
      meetingUrl: payload.metadata?.videoCallUrl,
      eventName: payload.title,
      platform: 'cal_com',
    };
  }

  return null;
}

/**
 * POST /api/webhooks/booking/[webhook_id]
 * Receives booking events from Calendly or Cal.com.
 * Cross-references attendee email with leads and records the meeting.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ webhook_id: string }> }
) {
  const { webhook_id } = await params;

  try {
    const body = await request.json();
    console.log(`[BookingWebhook] Received event for webhook_id=${webhook_id}`);

    // Look up agent by webhook_id
    const agents = await getAllAgents();
    const agent = agents.find((a) => a.webhook_id === webhook_id);

    if (!agent) {
      console.warn(`[BookingWebhook] No agent found for webhook_id=${webhook_id}`);
      return NextResponse.json({ error: 'Invalid webhook URL' }, { status: 404 });
    }

    // Normalize the payload
    const booking = normalizeBookingPayload(body);
    if (!booking) {
      // Cal.com and Calendly send test/ping payloads — respond 200 so verification passes
      console.log('[BookingWebhook] Ping or unrecognized payload, responding 200:', JSON.stringify(body).slice(0, 300));
      return NextResponse.json({ success: true, message: 'Webhook received (ping/test)' });
    }

    if (!booking.attendeeEmail) {
      console.warn('[BookingWebhook] No attendee email in payload');
      return NextResponse.json({ success: true, message: 'No attendee email, skipped' });
    }

    console.log(`[BookingWebhook] Booking event: ${booking.attendeeName} (${booking.attendeeEmail}) via ${booking.platform}`);

    // Cross-reference: Step 1 - Exact email match for this agent
    let matchedLead = await getInterestedLeadByEmail(agent.id, booking.attendeeEmail);

    // Step 2 - If no exact match, search by email domain across all agents
    if (!matchedLead) {
      const domain = booking.attendeeEmail.split('@')[1];
      if (domain) {
        const domainLeads = await findLeadsByEmailDomain(domain);
        if (domainLeads.length > 0) {
          // Prefer leads from the same agent, then most recently updated
          matchedLead = domainLeads.find((l) => l.agent_id === agent.id) || domainLeads[0];
          console.log(`[BookingWebhook] Domain match found: ${matchedLead.lead_email} (agent: ${matchedLead.agent_id})`);
        }
      }
    } else {
      console.log(`[BookingWebhook] Exact email match found: ${matchedLead.lead_email}`);
    }

    // Format meeting time for display
    const meetingTimeDisplay = booking.meetingTime
      ? new Date(booking.meetingTime).toLocaleString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZoneName: 'short',
        })
      : undefined;

    // Always create a meeting record
    const meeting = await createMeetingBooked({
      agent_id: agent.id,
      lead_id: matchedLead?.id,
      lead_email: booking.attendeeEmail,
      lead_name: booking.attendeeName || matchedLead?.lead_name,
      meeting_url: booking.meetingUrl,
      booking_platform: booking.platform,
      booked_at: booking.meetingTime || new Date().toISOString(),
    });

    console.log(`[BookingWebhook] Meeting recorded: ${meeting.id} (lead matched: ${!!matchedLead})`);

    // If lead matched, add a system note to their conversation thread
    if (matchedLead) {
      try {
        const updatedThread = [
          ...matchedLead.conversation_thread,
          {
            role: 'agent' as const,
            content: `[Meeting Booked] via ${booking.platform === 'cal_com' ? 'Cal.com' : 'Calendly'}: ${booking.eventName || 'Meeting'}${meetingTimeDisplay ? ` on ${meetingTimeDisplay}` : ''}`,
            timestamp: new Date().toISOString(),
          },
        ];

        await updateInterestedLead(matchedLead.id, {
          conversation_thread: updatedThread,
          conversation_status: 'completed',
          next_followup_due_at: null,
        });
      } catch (updateError) {
        console.warn('[BookingWebhook] Failed to update lead thread:', updateError);
      }
    }

    // Send Slack notification
    if (agent.slack_webhook_url) {
      const appUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
        ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
        : process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

      try {
        await sendMeetingAutoDetectedNotification(agent.slack_webhook_url, {
          attendeeName: booking.attendeeName,
          attendeeEmail: booking.attendeeEmail,
          eventName: booking.eventName,
          meetingTime: meetingTimeDisplay,
          platform: booking.platform,
          agentName: agent.name,
          matchedLead: matchedLead
            ? { name: matchedLead.lead_name, email: matchedLead.lead_email }
            : undefined,
          inboxUrl: `${appUrl}/inbox`,
        });
      } catch (slackError) {
        console.warn('[BookingWebhook] Failed to send Slack notification:', slackError);
      }
    }

    return NextResponse.json({
      success: true,
      meeting_id: meeting.id,
      lead_matched: !!matchedLead,
      matched_lead_email: matchedLead?.lead_email,
    });
  } catch (error: any) {
    console.error('[BookingWebhook] Error processing booking event:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
