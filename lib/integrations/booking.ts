import { CalComClient } from './calcom';
import { CalendlyClient } from './calendly';
import type { Agent, BookingAction, AvailableSlot } from '../types';

export interface BookingClient {
  getAvailableSlots(daysAhead?: number): Promise<AvailableSlot[]>;
  executeBooking?(params: {
    date: string;
    startTime: string;
    timezone: string;
    attendeeName: string;
    attendeeEmail: string;
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string }>;
  getBookingLink(): string | undefined;
}

class CalComBookingAdapter implements BookingClient {
  private client: CalComClient;
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
    this.client = new CalComClient(agent.booking_api_key!);
  }

  async getAvailableSlots(daysAhead = 7): Promise<AvailableSlot[]> {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1); // Buffer: start 1 min in the future
    const end = new Date(now);
    end.setDate(end.getDate() + daysAhead);

    return this.client.getAvailableSlots({
      eventTypeId: parseInt(this.agent.booking_event_id!, 10),
      startTime: now.toISOString(),
      endTime: end.toISOString(),
    });
  }

  async executeBooking(params: {
    date: string;
    startTime: string;
    timezone: string;
    attendeeName: string;
    attendeeEmail: string;
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string }> {
    try {
      // Build ISO datetime from date + time + timezone
      const startISO = `${params.date}T${params.startTime}:00`;

      const result = await this.client.createBooking({
        eventTypeId: parseInt(this.agent.booking_event_id!, 10),
        start: startISO,
        attendeeName: params.attendeeName,
        attendeeEmail: params.attendeeEmail,
        attendeeTimezone: params.timezone,
        notes: `Booked automatically by Reply Agent (${this.agent.name})`,
      });

      return {
        success: true,
        meetingUrl: result.meetingUrl,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Failed to create booking',
      };
    }
  }

  getBookingLink(): string | undefined {
    return this.agent.booking_link;
  }
}

/**
 * Build a Calendly URL with pre-filled name, email, and target month/date.
 * Calendly scheduling pages accept these query params:
 *   name  – pre-fills the invitee name field
 *   email – pre-fills the invitee email field
 *   month – YYYY-MM to navigate to the correct month
 *   date  – YYYY-MM-DD to highlight the target date
 */
export function buildCalendlyPrefilledUrl(
  baseUrl: string,
  name: string,
  email: string,
  date?: string,
): string {
  const url = new URL(baseUrl);
  if (name) url.searchParams.set('name', name);
  if (email) url.searchParams.set('email', email);
  if (date) {
    // month param navigates to the right month view
    url.searchParams.set('month', date.slice(0, 7)); // YYYY-MM
    url.searchParams.set('date', date); // YYYY-MM-DD
  }
  return url.toString();
}

class CalendlyBookingAdapter implements BookingClient {
  private client: CalendlyClient;
  private agent: Agent;

  constructor(agent: Agent) {
    this.agent = agent;
    this.client = new CalendlyClient(agent.booking_api_key!);
  }

  async getAvailableSlots(daysAhead = 7): Promise<AvailableSlot[]> {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 1); // Buffer: start 1 min in the future
    const end = new Date(now);
    end.setDate(end.getDate() + daysAhead);

    return this.client.getAvailableTimes({
      eventTypeUri: this.agent.booking_event_id!,
      startTime: now.toISOString(),
      endTime: end.toISOString(),
    });
  }

  async executeBooking(params: {
    date: string;
    startTime: string;
    timezone: string;
    attendeeName: string;
    attendeeEmail: string;
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string }> {
    // Build ISO datetime from date + time
    const startISO = `${params.date}T${params.startTime}:00`;

    // Step 1: Try direct booking via Calendly Scheduling API (POST /invitees)
    // This creates the event and sends calendar invites automatically.
    // Requires a paid Calendly plan.
    try {
      const result = await this.client.createBooking({
        eventTypeUri: this.agent.booking_event_id!,
        startTime: startISO,
        inviteeName: params.attendeeName,
        inviteeEmail: params.attendeeEmail,
        inviteeTimezone: params.timezone,
      });

      console.log(`[Calendly] Direct booking created: ${result.uri}`);
      return {
        success: true,
        meetingUrl: result.schedulingUrl || result.uri,
      };
    } catch (directError: any) {
      console.warn('[Calendly] Direct booking failed (may need paid plan), falling back to scheduling link:', directError.message);
    }

    // Step 2: Fallback — create a pre-filled scheduling link
    try {
      const result = await this.client.createSchedulingLink({
        eventTypeUri: this.agent.booking_event_id!,
        maxEventCount: 1,
      });

      const prefilledUrl = buildCalendlyPrefilledUrl(
        result.booking_url,
        params.attendeeName,
        params.attendeeEmail,
        params.date,
      );

      return {
        success: true,
        meetingUrl: prefilledUrl,
      };
    } catch (linkError: any) {
      // Step 3: Final fallback — static booking link
      const fallbackLink = this.agent.booking_link;
      if (fallbackLink) {
        console.warn('[Calendly] Scheduling link also failed, using static booking link:', linkError.message);
        const prefilledFallback = buildCalendlyPrefilledUrl(
          fallbackLink,
          params.attendeeName,
          params.attendeeEmail,
          params.date,
        );
        return {
          success: true,
          meetingUrl: prefilledFallback,
        };
      }
      return {
        success: false,
        error: linkError.message || 'Failed to create Calendly booking',
      };
    }
  }

  getBookingLink(): string | undefined {
    return this.agent.booking_link;
  }
}

export function createBookingClient(agent: Agent): BookingClient | null {
  if (!agent.booking_platform || !agent.booking_api_key || !agent.booking_event_id) {
    return null;
  }

  switch (agent.booking_platform) {
    case 'cal_com':
      return new CalComBookingAdapter(agent);
    case 'calendly':
      return new CalendlyBookingAdapter(agent);
    default:
      return null;
  }
}

function formatSlotsForPrompt(
  slots: AvailableSlot[],
  platform: string,
  bookingLink?: string
): string {
  // Group by date, limit to 15 slots
  const limited = slots.slice(0, 15);
  const byDate: Record<string, string[]> = {};

  for (const slot of limited) {
    if (!byDate[slot.date]) byDate[slot.date] = [];
    byDate[slot.date].push(slot.start_time);
  }

  let result = '';
  for (const [date, times] of Object.entries(byDate)) {
    const dayStr = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    });
    result += `${dayStr}: ${times.join(', ')}\n`;
  }

  if (bookingLink) {
    result += `\nBooking link: ${bookingLink}`;
  }

  return result.trim();
}

export async function getAvailabilityContext(agent: Agent): Promise<string> {
  const client = createBookingClient(agent);
  if (!client) return '';

  try {
    const slots = await client.getAvailableSlots(7);
    if (slots.length === 0) return 'No available calendar slots found in the next 7 days.';

    return formatSlotsForPrompt(slots, agent.booking_platform!, agent.booking_link);
  } catch (error) {
    console.warn('[Booking] Failed to fetch availability:', error);
    return '';
  }
}

export async function executeBookingAction(
  agent: Agent,
  action: BookingAction
): Promise<{ success: boolean; meetingUrl?: string; bookingLink?: string; error?: string }> {
  if (action.action === 'none') {
    return { success: true };
  }

  const client = createBookingClient(agent);
  if (!client) {
    return { success: false, error: 'No booking client configured' };
  }

  if (action.action === 'suggest_link') {
    const link = client.getBookingLink();
    if (!link) {
      return { success: false, error: 'No booking link configured' };
    }
    return {
      success: true,
      bookingLink: link,
    };
  }

  // action === 'book'
  if (!client.executeBooking) {
    // Platform doesn't support direct booking (e.g. Calendly)
    const link = client.getBookingLink();
    if (!link) {
      return { success: false, error: 'No booking link configured for this platform' };
    }
    return {
      success: true,
      bookingLink: link,
    };
  }

  if (!action.date || !action.start_time || !action.attendee_email) {
    return { success: false, error: 'Missing booking details (date, time, or email)' };
  }

  return client.executeBooking({
    date: action.date,
    startTime: action.start_time,
    timezone: action.timezone || 'UTC',
    attendeeName: action.attendee_name || 'Lead',
    attendeeEmail: action.attendee_email,
  });
}
