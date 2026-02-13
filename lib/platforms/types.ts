// =====================================================
// PLATFORM ABSTRACTION TYPES
// =====================================================

export type PlatformType = 'emailbison' | 'smartlead' | 'instantly';

/**
 * Canonical reply format - all platforms map to this
 */
export interface PlatformReply {
  id: string;
  campaign_id?: string;
  from_email: string;
  from_name?: string;
  subject?: string;
  body: string;
  html?: string;
  received_at: string;
  status: string;
  is_automated?: boolean;
  is_tracked?: boolean;
  lead_data?: Record<string, any>;
}

/**
 * Canonical campaign format
 */
export interface PlatformCampaign {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

/**
 * Canonical send request - includes optional platform-specific fields
 */
export interface PlatformSendRequest {
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
  // Smartlead-specific fields
  email_stats_id?: string;
  reply_message_id?: string;
  reply_email_time?: string;
  reply_email_body?: string;
  campaign_id?: string;
  // Instantly-specific fields
  eaccount?: string;
  reply_to_uuid?: string;
}

/**
 * Canonical send result
 */
export interface PlatformSendResult {
  success: boolean;
  message_id?: string;
}

/**
 * Canonical webhook reply - what normalizeWebhookPayload returns
 */
export interface NormalizedWebhookReply {
  id: string;
  uuid?: string;
  from_email_address: string;
  from_name?: string;
  subject?: string;
  text_body: string;
  html_body?: string;
  date_received: string;
  interested: boolean;
  automated_reply: boolean;
  tracked_reply?: boolean;
  campaign_id?: string;
  lead_data: Record<string, any>;
  // Smartlead-specific for sending replies later
  email_stats_id?: string;
  reply_message_id?: string;
  reply_email_time?: string;
  reply_email_body?: string;
  // Instantly-specific
  eaccount?: string;
  reply_to_uuid?: string;
}

/**
 * Interface all platform clients must implement
 */
export interface PlatformClient {
  readonly platform: PlatformType;

  getReplies(filters?: {
    status?: string;
    campaign_id?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: PlatformReply[]; total: number }>;

  getReply(replyId: string): Promise<PlatformReply>;

  sendReply(params: PlatformSendRequest): Promise<PlatformSendResult>;

  getCampaigns(): Promise<{ data: PlatformCampaign[] }>;

  testConnection(): Promise<boolean>;

  getInterestedReplies(campaignId?: string): Promise<PlatformReply[]>;

  fetchRepliesForProcessing(lastSyncDate?: Date): Promise<PlatformReply[]>;
}

/**
 * Platform error class
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public platform: PlatformType,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'PlatformError';
  }
}

/**
 * Get display name for a platform
 */
export function platformDisplayName(platform: PlatformType): string {
  switch (platform) {
    case 'emailbison':
      return 'EmailBison';
    case 'smartlead':
      return 'Smartlead';
    case 'instantly':
      return 'Instantly.ai';
  }
}
