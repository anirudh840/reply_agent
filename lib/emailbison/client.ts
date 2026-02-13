/**
 * Backward-compatibility wrapper for EmailBison client.
 * All platform clients are now in lib/platforms/.
 * This file is kept so existing imports continue to work.
 */
import { createPlatformClient } from '../platforms';
import type { PlatformClient } from '../platforms/types';

export { EmailBisonClient } from '../platforms/emailbison';

/**
 * @deprecated Use createPlatformClient() or createClientForAgent() from '@/lib/platforms' instead
 */
export function createEmailBisonClient(apiKey: string): PlatformClient {
  return createPlatformClient('emailbison', apiKey);
}
