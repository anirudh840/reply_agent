import type { AvailableSlot } from '../types';

const CALCOM_BASE_URL = 'https://api.cal.com';
const CALCOM_API_VERSION = '2024-08-13';

export interface CalComEventType {
  id: number;
  title: string;
  slug: string;
  length: number;
  description?: string;
}

export interface CalComBookingResult {
  id: number;
  uid: string;
  status: string;
  startTime: string;
  endTime: string;
  meetingUrl?: string;
}

export class CalComClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${CALCOM_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'cal-api-version': CALCOM_API_VERSION,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Cal.com API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getEventTypes();
      return true;
    } catch {
      return false;
    }
  }

  async getEventTypes(): Promise<CalComEventType[]> {
    const response = await this.request<{ status: string; data: any[] }>('/v2/event-types');

    return (response.data || []).map((et: any) => ({
      id: et.id,
      title: et.title || et.name || 'Untitled',
      slug: et.slug || '',
      length: et.lengthInMinutes || et.length || 30,
      description: et.description,
    }));
  }

  async getAvailableSlots(params: {
    eventTypeId: number;
    startTime: string;
    endTime: string;
  }): Promise<AvailableSlot[]> {
    const query = new URLSearchParams({
      startTime: params.startTime,
      endTime: params.endTime,
      eventTypeId: params.eventTypeId.toString(),
    });

    const response = await this.request<{ status: string; data: any }>(
      `/v2/slots/available?${query.toString()}`
    );

    const slots: AvailableSlot[] = [];
    const slotsData = response.data?.slots || response.data || {};

    // Cal.com returns slots grouped by date: { "2026-02-16": [{ time: "09:00" }, ...] }
    for (const [date, dateSlots] of Object.entries(slotsData)) {
      if (!Array.isArray(dateSlots)) continue;
      for (const slot of dateSlots) {
        const startTime = slot.time || slot.start;
        if (!startTime) continue;

        // Parse the time - could be ISO string or HH:mm
        const startDate = new Date(startTime);
        const isIso = !isNaN(startDate.getTime()) && startTime.includes('T');

        slots.push({
          date: isIso ? startDate.toISOString().split('T')[0] : date,
          start_time: isIso
            ? startDate.toISOString().split('T')[1].slice(0, 5)
            : startTime.slice(0, 5),
          end_time: '', // Cal.com slots have a fixed duration
          timezone: 'UTC',
        });
      }
    }

    return slots;
  }

  async createBooking(params: {
    eventTypeId: number;
    start: string;
    attendeeName: string;
    attendeeEmail: string;
    attendeeTimezone: string;
    notes?: string;
  }): Promise<CalComBookingResult> {
    const response = await this.request<{ status: string; data: any }>('/v2/bookings', {
      method: 'POST',
      body: JSON.stringify({
        eventTypeId: params.eventTypeId,
        start: params.start,
        attendee: {
          name: params.attendeeName,
          email: params.attendeeEmail,
          timeZone: params.attendeeTimezone,
        },
        metadata: {
          source: 'reply-agent',
        },
        ...(params.notes ? { notes: params.notes } : {}),
      }),
    });

    const booking = response.data;
    return {
      id: booking.id,
      uid: booking.uid,
      status: booking.status,
      startTime: booking.startTime || booking.start,
      endTime: booking.endTime || booking.end,
      meetingUrl: booking.meetingUrl || booking.metadata?.videoCallUrl,
    };
  }
}
