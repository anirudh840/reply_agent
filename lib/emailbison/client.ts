import { EMAILBISON_BASE_URL, RATE_LIMITS } from '../constants';
import { EmailBisonError, type EmailBisonReply, type EmailBisonCampaign } from '../types';
import { retryWithBackoff } from '../utils';

export class EmailBisonClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = EMAILBISON_BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      // Handle rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 5000;
        throw new EmailBisonError(
          `Rate limited. Retry after ${waitMs}ms`,
          429,
          { retryAfter: waitMs }
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new EmailBisonError(
          errorData.message || `EmailBison API error: ${response.statusText}`,
          response.status,
          errorData
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof EmailBisonError) {
        throw error;
      }
      throw new EmailBisonError(
        'Failed to make EmailBison API request',
        undefined,
        error
      );
    }
  }

  /**
   * Map EmailBison API reply to our EmailBisonReply type
   */
  private mapApiReplyToEmailBisonReply(apiReply: any): EmailBisonReply {
    return {
      id: apiReply.id?.toString() || apiReply.uuid,
      campaign_id: apiReply.campaign_id?.toString(),
      from_email: apiReply.from_email_address || apiReply.from_email || '',
      from_name: apiReply.from_name,
      subject: apiReply.subject,
      body: apiReply.text_body || apiReply.body || '', // Map text_body to body
      html: apiReply.html_body || apiReply.html,
      received_at: apiReply.date_received || apiReply.received_at || apiReply.created_at,
      status: apiReply.interested ? 'interested' : 'not_interested',
      is_automated: apiReply.automated_reply,
      is_tracked: apiReply.tracked_reply,
      lead_data: apiReply,
    };
  }

  /**
   * Fetch all replies with optional filters
   * Uses POST /api/replies as per EmailBison API documentation
   */
  async getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: EmailBisonReply[]; total: number }> {
    const endpoint = `/replies`;

    // Build request body according to EmailBison API spec
    const requestBody: any = {};

    // Add status filter to body (not query params)
    if (filters?.status) {
      requestBody.status = filters.status;
    }

    if (filters?.campaign_id) {
      requestBody.campaign_id = filters.campaign_id;
    }

    if (filters?.limit) {
      requestBody.limit = filters.limit;
    }

    if (filters?.offset) {
      requestBody.offset = filters.offset;
    }

    const response = await retryWithBackoff(
      () => this.request<{ data: any[]; total?: number }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }),
      RATE_LIMITS.MAX_RETRIES
    );

    // Map API replies to our format
    const mappedData = response.data.map((reply) => this.mapApiReplyToEmailBisonReply(reply));

    // Additional client-side filtering for interested leads (exclude automated)
    const filteredData = filters?.status === 'interested'
      ? mappedData.filter((reply) => reply.status === 'interested' && !reply.is_automated)
      : mappedData;

    return {
      data: filteredData,
      total: filteredData.length,
    };
  }

  /**
   * Get a specific reply by ID
   */
  async getReply(replyId: string): Promise<EmailBisonReply> {
    const apiReply = await retryWithBackoff(
      () => this.request<any>(`/replies/${replyId}`),
      RATE_LIMITS.MAX_RETRIES
    );
    return this.mapApiReplyToEmailBisonReply(apiReply);
  }

  /**
   * Send a reply to a lead
   */
  async sendReply(params: {
    replyId: string;
    message: string;
    subject?: string;
    cc?: string[];
    bcc?: string[];
    attachments?: Array<{
      filename: string;
      url: string;
      contentType: string;
    }>;
  }): Promise<{ success: boolean; message_id?: string }> {
    const requestBody: any = {
      message: params.message,
      reply_all: true, // Reply to all recipients automatically
    };

    if (params.subject) requestBody.subject = params.subject;
    if (params.cc && params.cc.length > 0) requestBody.cc = params.cc;
    if (params.bcc && params.bcc.length > 0) requestBody.bcc = params.bcc;
    if (params.attachments && params.attachments.length > 0) {
      requestBody.attachments = params.attachments;
    }

    return retryWithBackoff(
      () =>
        this.request<{ success: boolean; message_id?: string }>(
          `/replies/${params.replyId}/reply`,
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
          }
        ),
      RATE_LIMITS.MAX_RETRIES
    );
  }

  /**
   * Mark a reply as interested
   */
  async markAsInterested(replyId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/replies/${replyId}/mark-as-interested`,
      {
        method: 'PATCH',
      }
    );
  }

  /**
   * Get all campaigns
   */
  async getCampaigns(): Promise<{ data: EmailBisonCampaign[] }> {
    return retryWithBackoff(
      () => this.request<{ data: EmailBisonCampaign[] }>('/campaigns'),
      RATE_LIMITS.MAX_RETRIES
    );
  }

  /**
   * Get a specific campaign
   */
  async getCampaign(campaignId: string): Promise<EmailBisonCampaign> {
    return retryWithBackoff(
      () => this.request<EmailBisonCampaign>(`/campaigns/${campaignId}`),
      RATE_LIMITS.MAX_RETRIES
    );
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.getCampaigns();
      return true;
    } catch (error) {
      if (error instanceof EmailBisonError && error.statusCode === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Fetch interested replies (status = interested)
   */
  async getInterestedReplies(campaignId?: string): Promise<EmailBisonReply[]> {
    const filters: any = { status: 'interested' };
    if (campaignId) filters.campaign_id = campaignId;

    const result = await this.getReplies(filters);
    return result.data;
  }

  /**
   * Fetch non-automated replies
   */
  async getNonAutomatedReplies(campaignId?: string): Promise<EmailBisonReply[]> {
    // First get all replies, then filter
    const filters: any = {};
    if (campaignId) filters.campaign_id = campaignId;

    const result = await this.getReplies(filters);
    return result.data.filter((reply) => !reply.is_automated);
  }

  /**
   * Batch fetch replies for processing
   */
  async fetchRepliesForProcessing(
    lastSyncDate?: Date
  ): Promise<EmailBisonReply[]> {
    const allReplies: EmailBisonReply[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const result = await this.getReplies({ limit, offset });
      const filteredReplies = result.data.filter((reply) => {
        // Filter by interested or non-automated
        const isRelevant =
          reply.status === 'interested' || !reply.is_automated;

        // Filter by sync date if provided
        if (lastSyncDate && isRelevant) {
          const replyDate = new Date(reply.received_at);
          return replyDate > lastSyncDate;
        }

        return isRelevant;
      });

      allReplies.push(...filteredReplies);

      // Check if there are more pages
      hasMore = result.data.length === limit;
      offset += limit;

      // Safety limit to prevent infinite loops
      if (offset > 1000) break;
    }

    return allReplies;
  }
}

/**
 * Create an EmailBison client instance
 */
export function createEmailBisonClient(apiKey: string): EmailBisonClient {
  return new EmailBisonClient(apiKey);
}
