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
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  return `${baseUrl}/api/webhooks/${webhookId}`;
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
