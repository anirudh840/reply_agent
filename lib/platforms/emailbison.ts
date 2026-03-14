import { EMAILBISON_BASE_URL, RATE_LIMITS } from '../constants';
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

export class EmailBisonClient implements PlatformClient {
  readonly platform: PlatformType = 'emailbison';
  private apiKey: string;
  private baseUrl: string;

  constructor({ apiKey, instanceUrl }: { apiKey: string; instanceUrl?: string }) {
    this.apiKey = apiKey;
    if (instanceUrl) {
      // Strip protocol and trailing slash, then build URL
      const cleanUrl = instanceUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      this.baseUrl = `https://${cleanUrl}/api`;
    } else {
      this.baseUrl = EMAILBISON_BASE_URL;
    }
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
          'emailbison',
          429,
          { retryAfter: waitMs }
        );
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new PlatformError(
          errorData.message || `EmailBison API error: ${response.statusText}`,
          'emailbison',
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
        'Failed to make EmailBison API request',
        'emailbison',
        undefined,
        error
      );
    }
  }

  private mapApiReply(apiReply: any): PlatformReply {
    return {
      id: apiReply.id?.toString() || apiReply.uuid,
      campaign_id: apiReply.campaign_id?.toString(),
      from_email: apiReply.from_email_address || apiReply.from_email || '',
      from_name: apiReply.from_name,
      subject: apiReply.subject,
      body: apiReply.text_body || apiReply.body || '',
      html: apiReply.html_body || apiReply.html,
      received_at: apiReply.date_received || apiReply.received_at || apiReply.created_at,
      status: apiReply.interested ? 'interested' : 'not_interested',
      is_automated: apiReply.automated_reply,
      is_tracked: apiReply.tracked_reply,
      lead_data: apiReply,
    };
  }

  async getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PlatformReply[]; total: number }> {
    const queryParams = new URLSearchParams();

    if (filters?.status) queryParams.append('status', filters.status);
    if (filters?.campaign_id) queryParams.append('campaign_id', filters.campaign_id);
    if (filters?.limit) queryParams.append('limit', filters.limit.toString());
    if (filters?.offset) queryParams.append('offset', filters.offset.toString());

    const qs = queryParams.toString();
    const endpoint = `/replies${qs ? `?${qs}` : ''}`;

    const response = await retryWithBackoff(
      () => this.request<{ data: any[]; meta?: any }>(endpoint),
      RATE_LIMITS.MAX_RETRIES
    );

    const mappedData = response.data.map((reply) => this.mapApiReply(reply));

    const filteredData =
      filters?.status === 'interested'
        ? mappedData.filter((reply) => reply.status === 'interested' && !reply.is_automated)
        : mappedData;

    return {
      data: filteredData,
      total: response.meta?.total ?? filteredData.length,
    };
  }

  async getReply(replyId: string): Promise<PlatformReply> {
    const apiReply = await retryWithBackoff(
      () => this.request<any>(`/replies/${replyId}`),
      RATE_LIMITS.MAX_RETRIES
    );
    return this.mapApiReply(apiReply);
  }

  async sendReply(params: PlatformSendRequest): Promise<PlatformSendResult> {
    // If the message is already HTML (from rich text editor), use as-is.
    // Otherwise convert plain text newlines to HTML <br> for email formatting.
    const isHtml = /<[^>]+>/.test(params.message);
    const htmlMessage = isHtml
      ? params.message
      : params.message
          .replace(/\n\n/g, '<br><br>')
          .replace(/\n/g, '<br>');

    const requestBody: any = {
      message: htmlMessage,
      reply_all: true,
    };

    if (params.subject) requestBody.subject = params.subject;

    // EmailBison expects cc/bcc as comma-separated strings, not arrays
    if (params.cc && params.cc.length > 0) {
      requestBody.cc = params.cc.join(', ');
    }
    if (params.bcc && params.bcc.length > 0) {
      requestBody.bcc = params.bcc.join(', ');
    }

    // Note: EmailBison reply endpoint does not support attachments.
    // Attachments are silently omitted to avoid 422 errors.
    if (params.attachments && params.attachments.length > 0) {
      console.warn(
        '[EmailBison] Attachments are not supported on the reply endpoint and will be omitted.',
        params.attachments.map((a) => a.filename)
      );
    }

    const response = await retryWithBackoff(
      () =>
        this.request<any>(
          `/replies/${params.replyId}/reply`,
          {
            method: 'POST',
            body: JSON.stringify(requestBody),
          }
        ),
      RATE_LIMITS.MAX_RETRIES
    );

    // Normalize the response to PlatformSendResult.
    // If we reached here without an exception, the HTTP request succeeded (2xx).
    // The raw API response may not have a `success` field, so we explicitly set it.
    return {
      success: true,
      message_id: response?.message_id || response?.id?.toString(),
    };
  }

  async markAsInterested(replyId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/replies/${replyId}/mark-as-interested`,
      { method: 'PATCH' }
    );
  }

  async getCampaigns(): Promise<{ data: PlatformCampaign[] }> {
    return retryWithBackoff(
      () => this.request<{ data: PlatformCampaign[] }>('/campaigns'),
      RATE_LIMITS.MAX_RETRIES
    );
  }

  async getCampaign(campaignId: string): Promise<PlatformCampaign> {
    return retryWithBackoff(
      () => this.request<PlatformCampaign>(`/campaigns/${campaignId}`),
      RATE_LIMITS.MAX_RETRIES
    );
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.getCampaigns();
      return true;
    } catch (error) {
      if (error instanceof PlatformError && error.statusCode === 401) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Fetch all replies for a specific lead by lead_id.
   * This gives us the full conversation thread from the platform.
   */
  async getRepliesByLeadId(leadId: string): Promise<PlatformReply[]> {
    const queryParams = new URLSearchParams();
    queryParams.append('lead_id', leadId);

    const endpoint = `/replies?${queryParams.toString()}`;

    try {
      const response = await retryWithBackoff(
        () => this.request<{ data: any[]; meta?: any }>(endpoint),
        RATE_LIMITS.MAX_RETRIES
      );

      return response.data.map((reply) => this.mapApiReply(reply));
    } catch (error) {
      console.error(
        `[EmailBison] Error fetching replies for lead ${leadId}:`,
        error
      );
      return [];
    }
  }

  async getInterestedReplies(campaignId?: string): Promise<PlatformReply[]> {
    const filters: any = { status: 'interested' };
    if (campaignId) filters.campaign_id = campaignId;

    const result = await this.getReplies(filters);
    return result.data;
  }

  async getNonAutomatedReplies(campaignId?: string): Promise<PlatformReply[]> {
    const filters: any = {};
    if (campaignId) filters.campaign_id = campaignId;

    const result = await this.getReplies(filters);
    return result.data.filter((reply) => !reply.is_automated);
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
