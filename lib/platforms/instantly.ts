import { INSTANTLY_BASE_URL, RATE_LIMITS } from '../constants';
import { retryWithBackoff } from '../utils';
import type {
  PlatformClient,
  PlatformReply,
  PlatformCampaign,
  PlatformSendRequest,
  PlatformSendResult,
  PlatformType,
} from './types';
import { PlatformError } from './types';

export class InstantlyClient implements PlatformClient {
  readonly platform: PlatformType = 'instantly';
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
    this.baseUrl = INSTANTLY_BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
        throw new PlatformError(
          `Rate limited. Retry after ${waitMs}ms`,
          'instantly',
          429,
          { retryAfter: waitMs }
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PlatformError(
          errorData.message || errorData.error || `Instantly API error: ${response.statusText}`,
          'instantly',
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof PlatformError) {
        throw error;
      }
      throw new PlatformError(
        'Failed to make Instantly API request',
        'instantly',
        undefined,
        error
      );
    }
  }

  private mapApiReply(apiReply: any): PlatformReply {
    const body = apiReply.body || {};

    return {
      id: apiReply.id || '',
      campaign_id: apiReply.campaign_id,
      from_email: apiReply.from_address_email || '',
      from_name: apiReply.from_address_name || '',
      subject: apiReply.subject || '',
      body: typeof body === 'string' ? body : body.text || '',
      html: typeof body === 'string' ? undefined : body.html,
      received_at: apiReply.timestamp_email || apiReply.timestamp_created || new Date().toISOString(),
      status: this.determineStatus(apiReply),
      is_automated: apiReply.is_auto_reply || false,
      is_tracked: false,
      lead_data: apiReply,
    };
  }

  private determineStatus(apiReply: any): string {
    // Instantly provides ai_interest_value (0-1 scale)
    if (apiReply.ai_interest_value !== undefined && apiReply.ai_interest_value >= 0.5) {
      return 'interested';
    }
    // Also check labels or interest status
    if (apiReply.interested === true || apiReply.status === 'interested') {
      return 'interested';
    }
    return 'not_interested';
  }

  async getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PlatformReply[]; total: number }> {
    const queryParams = new URLSearchParams();

    if (filters?.campaign_id) queryParams.append('campaign_id', filters.campaign_id);
    if (filters?.limit) queryParams.append('limit', filters.limit.toString());
    if (filters?.offset) queryParams.append('skip', filters.offset.toString());

    const qs = queryParams.toString();
    const endpoint = `/emails${qs ? `?${qs}` : ''}`;

    const response = await retryWithBackoff(
      () => this.request<any>(endpoint),
      RATE_LIMITS.MAX_RETRIES
    );

    // Handle both array and object response formats
    const items = Array.isArray(response) ? response : response.data || [];
    const mappedData = items.map((item: any) => this.mapApiReply(item));

    // Client-side filter for interested status
    const filteredData =
      filters?.status === 'interested'
        ? mappedData.filter((reply: PlatformReply) => reply.status === 'interested' && !reply.is_automated)
        : mappedData;

    return {
      data: filteredData,
      total: filteredData.length,
    };
  }

  async getReply(replyId: string): Promise<PlatformReply> {
    const apiReply = await retryWithBackoff(
      () => this.request<any>(`/emails/${replyId}`),
      RATE_LIMITS.MAX_RETRIES
    );
    return this.mapApiReply(apiReply);
  }

  async sendReply(params: PlatformSendRequest): Promise<PlatformSendResult> {
    const requestBody: any = {
      reply_to_uuid: params.reply_to_uuid || params.replyId,
      body: {
        text: params.message,
        html: `<p>${params.message.replace(/\n/g, '<br/>')}</p>`,
      },
    };

    if (params.eaccount) requestBody.eaccount = params.eaccount;
    if (params.subject) requestBody.subject = params.subject;

    const response = await retryWithBackoff(
      () =>
        this.request<any>('/emails/reply', {
          method: 'POST',
          body: JSON.stringify(requestBody),
        }),
      RATE_LIMITS.MAX_RETRIES
    );

    return {
      success: true,
      message_id: response.id || response.message_id,
    };
  }

  async getCampaigns(): Promise<{ data: PlatformCampaign[] }> {
    const response = await retryWithBackoff(
      () => this.request<any>('/campaigns'),
      RATE_LIMITS.MAX_RETRIES
    );

    const items = Array.isArray(response) ? response : response.data || [];
    const campaigns: PlatformCampaign[] = items.map((c: any) => ({
      id: c.id || '',
      name: c.name || '',
      status: c.status || 'unknown',
      created_at: c.timestamp_created || c.created_at || new Date().toISOString(),
    }));

    return { data: campaigns };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getCampaigns();
      return true;
    } catch (error) {
      if (error instanceof PlatformError && (error.statusCode === 401 || error.statusCode === 403)) {
        return false;
      }
      throw error;
    }
  }

  async getInterestedReplies(campaignId?: string): Promise<PlatformReply[]> {
    const filters: any = { status: 'interested' };
    if (campaignId) filters.campaign_id = campaignId;

    const result = await this.getReplies(filters);
    return result.data;
  }

  async fetchRepliesForProcessing(lastSyncDate?: Date): Promise<PlatformReply[]> {
    const allReplies: PlatformReply[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getReplies({ limit, offset });
      const filteredReplies = result.data.filter((reply) => {
        const isRelevant = reply.status === 'interested' || !reply.is_automated;

        if (lastSyncDate && isRelevant) {
          const replyDate = new Date(reply.received_at);
          return replyDate > lastSyncDate;
        }

        return isRelevant;
      });

      allReplies.push(...filteredReplies);

      hasMore = result.data.length === limit;
      offset += limit;

      if (offset > 1000) break;
    }

    return allReplies;
  }
}
