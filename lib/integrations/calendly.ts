import type { AvailableSlot } from '../types';

const CALENDLY_BASE_URL = 'https://api.calendly.com';

export interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  duration: number;
  scheduling_url: string;
}

export interface CalendlyBookingResult {
  uri: string;
  event_uri: string;
  status: string;
  schedulingUrl?: string;
}

export class CalendlyClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${CALENDLY_BASE_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Calendly API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getCurrentUser();
      return true;
    } catch {
      return false;
    }
  }

  async getCurrentUser(): Promise<{ uri: string; name: string; organizationUri: string }> {
    const response = await this.request<{ resource: any }>('/users/me');
    return {
      uri: response.resource.uri,
      name: response.resource.name,
      organizationUri: response.resource.current_organization,
    };
  }

  async getEventTypes(): Promise<CalendlyEventType[]> {
    const user = await this.getCurrentUser();
    const response = await this.request<{ collection: any[] }>(
      `/event_types?user=${encodeURIComponent(user.uri)}&active=true`
    );

    return (response.collection || []).map((et: any) => ({
      uri: et.uri,
      name: et.name || 'Untitled',
      slug: et.slug || '',
      duration: et.duration || 30,
      scheduling_url: et.scheduling_url || '',
    }));
  }

  async getAvailableTimes(params: {
    eventTypeUri: string;
    startTime: string;
    endTime: string;
  }): Promise<AvailableSlot[]> {
    const query = new URLSearchParams({
      event_type: params.eventTypeUri,
      start_time: params.startTime,
      end_time: params.endTime,
    });

    const response = await this.request<{ collection: any[] }>(
      `/event_type_available_times?${query.toString()}`
    );

    return (response.collection || []).map((slot: any) => {
      const startDate = new Date(slot.start_time);
      return {
        date: startDate.toISOString().split('T')[0],
        start_time: startDate.toISOString().split('T')[1].slice(0, 5),
        end_time: '', // Calendly slots have fixed duration
        timezone: 'UTC',
      };
    });
  }

  /**
   * Create a booking directly via the Calendly Scheduling API (POST /invitees).
   * This creates a scheduled event and sends calendar invites automatically.
   * Requires a paid Calendly plan.
   */
  async createBooking(params: {
    eventTypeUri: string;
    startTime: string; // Must be UTC ISO 8601, e.g. "2026-04-02T20:00:00Z" (callers must convert local→UTC first)
    inviteeName: string;
    inviteeEmail: string;
    inviteeTimezone: string; // IANA, e.g. "America/New_York"
  }): Promise<CalendlyBookingResult> {
    // Ensure start time ends with Z for UTC
    let startUtc = params.startTime;
    if (!startUtc.endsWith('Z') && !startUtc.includes('+')) {
      startUtc = `${startUtc}Z`;
    }

    // Fetch event type to get its location configuration
    const eventType = await this.request<{ resource: any }>(params.eventTypeUri);
    const locations: Array<{ kind: string }> = eventType.resource?.locations || [];

    // Build request body with correct Calendly Scheduling API field names
    const body: Record<string, any> = {
      event_type: params.eventTypeUri,
      start_time: startUtc,
      invitee: {
        name: params.inviteeName,
        email: params.inviteeEmail,
        timezone: params.inviteeTimezone,
      },
    };

    // Include location if the event type requires one
    if (locations.length > 0) {
      // Prefer video conferencing locations
      const preferred = locations.find(
        (l) => l.kind === 'google_conference' || l.kind === 'zoom_conference' || l.kind === 'microsoft_teams_conference'
      );
      body.location = { kind: (preferred || locations[0]).kind };
    }

    // Provide default answers for required custom questions so booking succeeds
    const customQuestions: Array<{ name: string; required: boolean; position: number; answer_choices?: string[]; type: string }> =
      eventType.resource?.custom_questions || [];
    const requiredQuestions = customQuestions.filter((q) => q.required);
    if (requiredQuestions.length > 0) {
      body.questions_and_answers = requiredQuestions.map((q) => ({
        question: q.name,
        answer: q.answer_choices?.length ? q.answer_choices[0] : (q.type === 'phone_number' ? '+10000000000' : 'N/A'),
        position: q.position,
      }));
    }

    const response = await this.request<{ resource: any }>('/invitees', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const invitee = response.resource;
    return {
      uri: invitee.uri,
      event_uri: invitee.event,
      status: invitee.status || 'active',
      schedulingUrl: invitee.reschedule_url || invitee.cancel_url,
    };
  }

  /**
   * Create a single-use scheduling link via Calendly API.
   * Fallback for accounts that don't support the Scheduling API (free plans).
   */
  async createSchedulingLink(params: {
    eventTypeUri: string;
    maxEventCount?: number;
  }): Promise<{ booking_url: string; owner_type: string }> {
    const response = await this.request<{ resource: any }>('/scheduling_links', {
      method: 'POST',
      body: JSON.stringify({
        max_event_count: params.maxEventCount || 1,
        owner: params.eventTypeUri,
        owner_type: 'EventType',
      }),
    });

    return {
      booking_url: response.resource.booking_url,
      owner_type: response.resource.owner_type,
    };
  }

  /**
   * Create a webhook subscription for booking events.
   * Calendly fires `invitee.created` when someone books a meeting.
   */
  async createWebhookSubscription(callbackUrl: string): Promise<{ webhookId: string }> {
    const user = await this.getCurrentUser();

    const response = await this.request<{ resource: any }>('/webhook_subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created'],
        organization: user.organizationUri,
        scope: 'organization',
      }),
    });

    return { webhookId: response.resource.uri };
  }

  /**
   * Delete a webhook subscription.
   */
  async deleteWebhookSubscription(webhookUri: string): Promise<void> {
    await this.request(webhookUri, { method: 'DELETE' });
  }
}
