import { randomUUID } from 'crypto';

/**
 * Generate a unique webhook ID for an agent
 */
export function generateWebhookId(): string {
  return randomUUID();
}

/**
 * Generate a webhook secret for verification (optional)
 */
export function generateWebhookSecret(): string {
  return randomUUID();
}

/**
 * Get the full webhook URL for an agent
 */
export function getWebhookUrl(webhookId: string): string {
  // Priority: VERCEL_PROJECT_PRODUCTION_URL (auto-set by Vercel in production)
  //         > VERCEL_URL (auto-set by Vercel for each deployment)
  //         > NEXT_PUBLIC_APP_URL (user-configured, may be stale)
  //         > localhost
  let baseUrl: string;

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    baseUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  } else if (process.env.VERCEL_URL) {
    baseUrl = `https://${process.env.VERCEL_URL}`;
  } else if (process.env.NEXT_PUBLIC_APP_URL) {
    baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  } else {
    baseUrl = 'http://localhost:3000';
  }

  // Remove trailing slash if present
  baseUrl = baseUrl.replace(/\/$/, '');

  return `${baseUrl}/api/webhooks/${webhookId}`;
}

/**
 * Get the booking webhook URL for an agent (receives Calendly/Cal.com events)
 */
export function getBookingWebhookUrl(webhookId: string): string {
  let baseUrl: string;

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    baseUrl = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  } else if (process.env.VERCEL_URL) {
    baseUrl = `https://${process.env.VERCEL_URL}`;
  } else if (process.env.NEXT_PUBLIC_APP_URL) {
    baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  } else {
    baseUrl = 'http://localhost:3000';
  }

  baseUrl = baseUrl.replace(/\/$/, '');
  return `${baseUrl}/api/webhooks/booking/${webhookId}`;
}

/**
 * Verify webhook signature (if webhook_secret is used)
 * This can be expanded based on EmailBison's webhook signing mechanism
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // Implement signature verification based on EmailBison's method
  // For now, return true (implement actual verification when EmailBison docs are available)
  return true;
}
