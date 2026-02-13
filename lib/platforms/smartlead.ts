import { SMARTLEAD_BASE_URL, RATE_LIMITS } from '../constants';
import { retryWithBackoff, sleep } from '../utils';
import type {
  PlatformClient,
  PlatformReply,
  PlatformCampaign,
  PlatformSendRequest,
  PlatformSendResult,
  PlatformType,
} from './types';
import { PlatformError } from './types';

// Smartlead interested categories
const INTERESTED_CATEGORIES = ['Interested', 'Meeting Request', 'Information Request'];

export class SmartleadClient implements PlatformClient {
  readonly platform: PlatformType = 'smartlead';
  private apiKey: string;
  private baseUrl: string;

  // Rate limiting: 10 requests per 2 seconds
  private lastWindowStart = 0;
  private requestsInWindow = 0;
  private readonly MAX_REQUESTS = 10;
  private readonly WINDOW_MS = 2000;

  constructor({ apiKey }: { apiKey: string }) {
    this.apiKey = apiKey;
    this.baseUrl = SMARTLEAD_BASE_URL;
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    if (now - this.lastWindowStart > this.WINDOW_MS) {
      this.requestsInWindow = 0;
      this.lastWindowStart = now;
    }
    if (this.requestsInWindow >= this.MAX_REQUESTS) {
      const waitTime = this.WINDOW_MS - (now - this.lastWindowStart);
      if (waitTime > 0) await sleep(waitTime);
      this.requestsInWindow = 0;
      this.lastWindowStart = Date.now();
    }
    this.requestsInWindow++;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    await this.throttle();

    // Append api_key to URL
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${this.baseUrl}${endpoint}${separator}api_key=${this.apiKey}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
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
          'smartlead',
          429,
          { retryAfter: waitMs }
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PlatformError(
          errorData.message || `Smartlead API error: ${response.statusText}`,
          'smartlead',
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
        'Failed to make Smartlead API request',
        'smartlead',
        undefined,
        error
      );
    }
  }

  private mapReply(item: any): PlatformReply {
    // Smartlead inbox reply format
    const lastMessage = item.email_history?.[item.email_history.length - 1];
    const leadEmail = item.lead_email || item.to_email || '';

    return {
      id: item.email_lead_map_id?.toString() || item.stats_id?.toString() || '',
      campaign_id: item.campaign_id?.toString(),
      from_email: leadEmail,
      from_name: item.lead_name || item.to_name || '',
      subject: lastMessage?.subject || item.subject || '',
      body: lastMessage?.text_body || lastMessage?.body || item.reply_body || '',
      html: lastMessage?.html_body || item.reply_html || '',
      received_at: item.last_reply_time || lastMessage?.time || new Date().toISOString(),
      status: this.mapCategory(item.lead_category || item.category),
      is_automated: false,
      is_tracked: false,
      lead_data: item,
    };
  }

  private mapCategory(category?: string): string {
    if (!category) return 'not_interested';
    return INTERESTED_CATEGORIES.includes(category) ? 'interested' : 'not_interested';
  }

  async getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PlatformReply[]; total: number }> {
    const body: any = {
      offset: filters?.offset || 0,
      limit: filters?.limit || 50,
      sortBy: 'REPLY_TIME_DESC',
      fetch_message_history: true,
      filters: {},
    };

    if (filters?.status === 'interested') {
      body.filters.leadCategories = INTERESTED_CATEGORIES.reduce(
        (acc: any, cat) => ({ ...acc, [cat]: true }),
        {}
      );
    }

    if (filters?.campaign_id) {
      body.filters.campaignId = [parseInt(filters.campaign_id)];
    }

    const response = await retryWithBackoff(
      () =>
        this.request<{ ok: boolean; data: any[]; offset?: number; limit?: number }>(
          '/master-inbox/inbox-replies',
          {
            method: 'POST',
            body: JSON.stringify(body),
          }
        ),
      RATE_LIMITS.MAX_RETRIES
    );

    const data = (response.data || []).map((item) => this.mapReply(item));

    // Client-side filter for interested if needed
    const filteredData =
      filters?.status === 'interested'
        ? data.filter((r) => r.status === 'interested')
        : data;

    return {
      data: filteredData,
      total: filteredData.length,
    };
  }

  async getReply(replyId: string): Promise<PlatformReply> {
    // Smartlead doesn't have a direct "get reply by ID" endpoint
    // Fetch from inbox and find the matching one
    const result = await this.getReplies({ limit: 100 });
    const reply = result.data.find((r) => r.id === replyId);
    if (!reply) {
      throw new PlatformError(
        `Reply ${replyId} not found`,
        'smartlead',
        404
      );
    }
    return reply;
  }

  async sendReply(params: PlatformSendRequest): Promise<PlatformSendResult> {
    if (!params.campaign_id) {
      throw new PlatformError(
        'campaign_id is required for Smartlead reply',
        'smartlead',
        400
      );
    }

    const requestBody: any = {
      email_body: params.message,
    };

    if (params.email_stats_id) requestBody.email_stats_id = params.email_stats_id;
    if (params.reply_message_id) requestBody.reply_message_id = params.reply_message_id;
    if (params.reply_email_time) requestBody.reply_email_time = params.reply_email_time;
    if (params.reply_email_body) requestBody.reply_email_body = params.reply_email_body;
    if (params.cc && params.cc.length > 0) requestBody.cc = params.cc.join(',');
    if (params.bcc && params.bcc.length > 0) requestBody.bcc = params.bcc.join(',');
    requestBody.add_signature = true;

    const response = await retryWithBackoff(
      () =>
        this.request<{ ok: boolean; data?: string }>(
          `/campaigns/${params.campaign_id}/reply-email-thread`,
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
          }
        ),
      RATE_LIMITS.MAX_RETRIES
    );

    return {
      success: response.ok !== false,
      message_id: undefined,
    };
  }

  async getCampaigns(): Promise<{ data: PlatformCampaign[] }> {
    const response = await retryWithBackoff(
      () => this.request<any[]>('/campaigns'),
      RATE_LIMITS.MAX_RETRIES
    );

    const campaigns: PlatformCampaign[] = (response || []).map((c: any) => ({
      id: c.id?.toString() || '',
      name: c.name || '',
      status: c.status || 'unknown',
      created_at: c.created_at || new Date().toISOString(),
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
    const limit = 50;
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

      if (offset > 500) break;
    }

    return allReplies;
  }
}
