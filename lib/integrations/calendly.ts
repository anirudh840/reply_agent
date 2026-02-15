import type { AvailableSlot } from '../types';

const CALENDLY_BASE_URL = 'https://api.calendly.com';

export interface CalendlyEventType {
  uri: string;
  name: string;
  slug: string;
  duration: number;
  scheduling_url: string;
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
}
