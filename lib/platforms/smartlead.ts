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

// Smartlead category ID mapping (verified against API):
// 1 = Interested
// 2 = Meeting Booked
// 3 = Not Interested
// 4 = Do Not Contact
// 5 = Wrong Person (alternate)
// 6 = Out of Office
// 7 = Wrong Person
const INTERESTED_CATEGORY_IDS = [1, 2]; // Interested + Meeting Booked
const AUTOMATED_CATEGORY_IDS = [6]; // Out of Office

// Max limit enforced by Smartlead API
const SMARTLEAD_MAX_LIMIT = 20;

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

  /**
   * Fetch message history for a specific lead in a campaign.
   * This is needed because the inbox-replies endpoint doesn't return message content.
   */
  private async getMessageHistory(
    campaignId: string,
    leadId: string
  ): Promise<{ history: any[]; from: string; to: string }> {
    return this.request<{ history: any[]; from: string; to: string }>(
      `/campaigns/${campaignId}/leads/${leadId}/message-history`
    );
  }

  /**
   * Map a Smartlead inbox item + its message history into a PlatformReply.
   * The inbox item has lead metadata but no message content.
   * The message history has the actual email bodies.
   */
  private mapReplyWithHistory(item: any, history?: any[]): PlatformReply {
    const leadEmail = item.lead_email || '';
    const leadName = [item.lead_first_name, item.lead_last_name]
      .filter(Boolean)
      .join(' ')
      .trim();

    // Find the latest REPLY message from the lead in the history
    const replyMessages = (history || []).filter((msg: any) => msg.type === 'REPLY');
    const lastReply = replyMessages[replyMessages.length - 1];

    // Extract text body from HTML if needed
    let textBody = '';
    let htmlBody = '';
    if (lastReply?.email_body) {
      htmlBody = lastReply.email_body;
      // Simple HTML to text extraction
      textBody = lastReply.email_body
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/div>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .trim();
    }

    const categoryId = item.lead_category_id;

    return {
      id: item.email_lead_map_id?.toString() || '',
      campaign_id: item.email_campaign_id?.toString(),
      from_email: leadEmail,
      from_name: leadName,
      subject: lastReply?.subject || '',
      body: textBody,
      html: htmlBody,
      received_at: item.last_reply_time || lastReply?.time || new Date().toISOString(),
      status: INTERESTED_CATEGORY_IDS.includes(categoryId) ? 'interested' : 'not_interested',
      is_automated: AUTOMATED_CATEGORY_IDS.includes(categoryId),
      is_tracked: false,
      lead_data: {
        ...item,
        stats_id: lastReply?.stats_id,
        reply_message_id: lastReply?.message_id,
        reply_time: lastReply?.time,
      },
    };
  }

  /**
   * Map a basic inbox item without message history (for quick listing).
   */
  private mapReplyBasic(item: any): PlatformReply {
    return this.mapReplyWithHistory(item, []);
  }

  async getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PlatformReply[]; total: number }> {
    // Smartlead API constraints:
    // - Max limit is 20
    // - Only allowed filters: campaignId (array), emailAccountId (array), search (string)
    // - No category filtering server-side - must filter client-side
    // - Inbox list does NOT return message content - need separate message-history calls
    const limit = Math.min(filters?.limit || SMARTLEAD_MAX_LIMIT, SMARTLEAD_MAX_LIMIT);

    const body: any = {
      offset: filters?.offset || 0,
      limit,
      sortBy: 'REPLY_TIME_DESC',
      filters: {},
    };

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

    const inboxItems = response.data || [];

    // Client-side filter for interested if requested
    let filteredItems = inboxItems;
    if (filters?.status === 'interested') {
      filteredItems = inboxItems.filter((item) =>
        INTERESTED_CATEGORY_IDS.includes(item.lead_category_id)
      );
    }

    // Fetch message history for each item to get actual reply content
    const repliesWithContent = await Promise.all(
      filteredItems.map(async (item) => {
        try {
          const campaignId = item.email_campaign_id?.toString();
          const leadId = item.email_lead_id?.toString();
          if (campaignId && leadId) {
            const messageHistory = await this.getMessageHistory(campaignId, leadId);
            return this.mapReplyWithHistory(item, messageHistory.history);
          }
          return this.mapReplyBasic(item);
        } catch (error) {
          // If message history fails, return basic info without body
          console.warn(`[Smartlead] Failed to fetch message history for lead ${item.email_lead_id}:`, error);
          return this.mapReplyBasic(item);
        }
      })
    );

    return {
      data: repliesWithContent,
      total: repliesWithContent.length,
    };
  }

  async getReply(replyId: string): Promise<PlatformReply> {
    // Fetch from inbox and find the matching one
    // Use max limit of 20 (API constraint)
    const result = await this.getReplies({ limit: SMARTLEAD_MAX_LIMIT });
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
    let hasMore = true;

    while (hasMore) {
      const result = await this.getReplies({ limit: SMARTLEAD_MAX_LIMIT, offset });
      const filteredReplies = result.data.filter((reply) => {
        const isRelevant = reply.status === 'interested' || !reply.is_automated;

        if (lastSyncDate && isRelevant) {
          const replyDate = new Date(reply.received_at);
          return replyDate > lastSyncDate;
        }

        return isRelevant;
      });

      allReplies.push(...filteredReplies);

      hasMore = result.data.length === SMARTLEAD_MAX_LIMIT;
      offset += SMARTLEAD_MAX_LIMIT;

      // Safety limit: max 10 pages (200 replies)
      if (offset > 200) break;
    }

    return allReplies;
  }
}
