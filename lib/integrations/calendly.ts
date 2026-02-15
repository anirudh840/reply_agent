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

  async getCurrentUser(): Promise<{ uri: string; name: string }> {
    const response = await this.request<{ resource: any }>('/users/me');
    return {
      uri: response.resource.uri,
      name: response.resource.name,
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
   * Create a single-use scheduling link via Calendly API.
   * Note: Calendly does NOT support direct programmatic booking creation
   * via REST API. Instead, we create a scheduling link that the lead can use.
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
    // Extract organization URI from user URI: /users/XXX -> /organizations/XXX
    const orgUri = user.uri.replace('/users/', '/organizations/');

    const response = await this.request<{ resource: any }>('/webhook_subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        url: callbackUrl,
        events: ['invitee.created'],
        organization: orgUri,
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
