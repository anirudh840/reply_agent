import type { PlatformType, PlatformClient } from './types';
import { EmailBisonClient } from './emailbison';
import { SmartleadClient } from './smartlead';
import { InstantlyClient } from './instantly';

/**
 * Create a platform client for the given platform type
 */
export function createPlatformClient(
  platform: PlatformType,
  apiKey: string,
  instanceUrl?: string
): PlatformClient {
  switch (platform) {
    case 'emailbison':
      return new EmailBisonClient({ apiKey, instanceUrl });
    case 'smartlead':
      return new SmartleadClient({ apiKey });
    case 'instantly':
      return new InstantlyClient({ apiKey });
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Create a platform client from an agent object
 */
export function createClientForAgent(agent: {
  platform?: PlatformType;
  emailbison_api_key: string;
  platform_instance_url?: string;
}): PlatformClient {
  const platform = agent.platform || 'emailbison';
  return createPlatformClient(platform, agent.emailbison_api_key, agent.platform_instance_url);
}

// Re-export types
export * from './types';
export { EmailBisonClient } from './emailbison';
export { SmartleadClient } from './smartlead';
export { InstantlyClient } from './instantly';
