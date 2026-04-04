import { CalComClient } from './calcom';
import { CalendlyClient } from './calendly';
import type { Agent, BookingAction, AvailableSlot } from '../types';

/**
 * Convert a local date/time + IANA timezone to a UTC ISO string.
 * Example: localTimeToUtc("2026-04-03", "16:00", "America/New_York") → "2026-04-03T20:00:00Z"
 *
 * Uses Intl.DateTimeFormat to resolve the timezone offset, avoiding external deps.
 */
function localTimeToUtc(date: string, time: string, timezone: string): string {
  // Build a date string in the local timezone and parse it
  const localStr = `${date}T${time}:00`;

  // Get the UTC offset for this timezone at this date/time
  // by formatting the same instant in UTC and in the target timezone
  const localDate = new Date(localStr);

  // Use a formatter to get the offset
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  // Format the UTC reference point in the target timezone to find the offset
  // Strategy: we know `localStr` is what the clock shows in `timezone`.
  // We need to find the UTC instant where the clock in `timezone` shows that time.
  // Approach: try parsing as UTC, get the timezone representation, compute the delta.
  const asUtc = new Date(localStr + 'Z'); // Interpret as UTC first
  const parts = formatter.formatToParts(asUtc);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '0';
  const tzYear = parseInt(get('year'));
  const tzMonth = parseInt(get('month'));
  const tzDay = parseInt(get('day'));
  const tzHour = parseInt(get('hour') === '24' ? '0' : get('hour'));
  const tzMinute = parseInt(get('minute'));

  // The difference between what UTC shows and what the timezone shows = offset
  const utcMs = Date.UTC(
    parseInt(date.slice(0, 4)), parseInt(date.slice(5, 7)) - 1, parseInt(date.slice(8, 10)),
    parseInt(time.slice(0, 2)), parseInt(time.slice(3, 5)), 0
  );
  const tzMs = Date.UTC(tzYear, tzMonth - 1, tzDay, tzHour, tzMinute, 0);
  const offsetMs = tzMs - utcMs; // positive = timezone is ahead of UTC

  // The actual UTC time = local time - offset
  const actualUtc = new Date(utcMs - offsetMs);
  return actualUtc.toISOString().replace('.000Z', 'Z');
}

export interface BookingClient {
  getAvailableSlots(daysAhead?: number): Promise<AvailableSlot[]>;
  executeBooking?(params: {
    date: string;
    startTime: string;
    timezone: string;
    attendeeName: string;
    attendeeEmail: string;
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string; directBooking?: boolean }>;
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
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string; directBooking?: boolean }> {
    try {
      // Convert local time + timezone to UTC for the calendar API
      const startUtc = localTimeToUtc(params.date, params.startTime, params.timezone);

      const result = await this.client.createBooking({
        eventTypeId: parseInt(this.agent.booking_event_id!, 10),
        start: startUtc,
        attendeeName: params.attendeeName,
        attendeeEmail: params.attendeeEmail,
        attendeeTimezone: params.timezone,
        notes: `Booked automatically by Reply Agent (${this.agent.name})`,
      });

      return {
        success: true,
        meetingUrl: result.meetingUrl,
        directBooking: true,
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
  }): Promise<{ success: boolean; meetingUrl?: string; error?: string; directBooking?: boolean }> {
    // Convert local time + timezone to UTC for the calendar API
    const startUtc = localTimeToUtc(params.date, params.startTime, params.timezone);

    // Step 1: Try direct booking via Calendly Scheduling API (POST /invitees)
    // This creates the event and sends calendar invites automatically.
    // Requires a paid Calendly plan.
    try {
      const result = await this.client.createBooking({
        eventTypeUri: this.agent.booking_event_id!,
        startTime: startUtc,
        inviteeName: params.attendeeName,
        inviteeEmail: params.attendeeEmail,
        inviteeTimezone: params.timezone,
      });

      console.log(`[Calendly] Direct booking created: ${result.uri}`);
      return {
        success: true,
        meetingUrl: result.schedulingUrl || result.uri,
        directBooking: true,
      };
    } catch (directError: any) {
      console.warn('[Calendly] Direct booking failed (may need paid plan), falling back to scheduling link:', directError.message);
    }

    // Step 2: Fallback — create a pre-filled scheduling link
    // NOTE: This is NOT a confirmed booking. The lead must click the link to finalize.
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
        directBooking: false,
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
          directBooking: false,
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

/**
 * Convert a UTC slot (date + HH:MM) to a local date + HH:MM in the given timezone.
 */
function utcSlotToLocal(
  utcDate: string,
  utcTime: string,
  timezone: string
): { date: string; time: string } {
  const utcMs = Date.UTC(
    parseInt(utcDate.slice(0, 4)),
    parseInt(utcDate.slice(5, 7)) - 1,
    parseInt(utcDate.slice(8, 10)),
    parseInt(utcTime.slice(0, 2)),
    parseInt(utcTime.slice(3, 5)),
    0
  );
  const utcDt = new Date(utcMs);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(utcDt);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  const localDate = `${get('year')}-${get('month')}-${get('day')}`;
  const h = get('hour') === '24' ? '00' : get('hour');
  const localTime = `${h}:${get('minute')}`;
  return { date: localDate, time: localTime };
}

function formatSlotsForPrompt(
  slots: AvailableSlot[],
  platform: string,
  bookingLink?: string,
  agentTimezone?: string
): string {
  // Convert UTC slots to the agent's timezone (or keep as UTC)
  const tz = agentTimezone || 'UTC';
  const limited = slots.slice(0, 15);
  const byDate: Record<string, string[]> = {};

  for (const slot of limited) {
    const local = utcSlotToLocal(slot.date, slot.start_time, tz);
    if (!byDate[local.date]) byDate[local.date] = [];
    byDate[local.date].push(local.time);
  }

  // Build a short timezone label (e.g. "ET", "CT", "IST")
  const tzLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz;

  let result = `All times shown in ${tzLabel}:\n`;
  for (const [date, times] of Object.entries(byDate)) {
    const dayStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
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

    return formatSlotsForPrompt(slots, agent.booking_platform!, agent.booking_link, agent.timezone);
  } catch (error) {
    console.warn('[Booking] Failed to fetch availability:', error);
    return '';
  }
}

export async function executeBookingAction(
  agent: Agent,
  action: BookingAction
): Promise<{ success: boolean; meetingUrl?: string; bookingLink?: string; error?: string; directBooking?: boolean }> {
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
