import { createHash, randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from './supabase/client';
import type { ExternalApiKey } from './types';

const API_KEY_PREFIX = 'eb_live_';

/**
 * Generate a new API key. Returns the raw key (show once) and the hash (store in DB).
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const random = randomBytes(32).toString('hex');
  const rawKey = `${API_KEY_PREFIX}${random}`;
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 16) + '...';
  return { rawKey, keyHash, keyPrefix };
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key from the Authorization header.
 * Returns the key record if valid, null if not.
 */
export async function validateApiKey(request: NextRequest): Promise<ExternalApiKey | null> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawKey = authHeader.slice(7);
  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;

  const keyHash = hashApiKey(rawKey);

  const { data: rawData, error } = await supabaseAdmin
    .from('external_api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .is('revoked_at', null)
    .single();

  if (error || !rawData) return null;
  const data = rawData as unknown as ExternalApiKey;

  // Update last_used_at (fire and forget)
  (supabaseAdmin
    .from('external_api_keys') as any)
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then();

  return data;
}

/**
 * Middleware-style helper: validates API key and returns error response if invalid.
 * Returns the key record + allowed agent IDs, or a NextResponse error.
 */
export async function requireApiKey(
  request: NextRequest
): Promise<{ apiKey: ExternalApiKey } | NextResponse> {
  const apiKey = await validateApiKey(request);

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Invalid or missing API key. Use Authorization: Bearer <your_api_key>' },
      { status: 401 }
    );
  }

  return { apiKey };
}

/**
 * Check if the API key has access to a specific scope.
 */
export function hasScope(apiKey: ExternalApiKey, scope: string): boolean {
  return apiKey.scopes.includes(scope);
}

/**
 * Build a Supabase filter for agent_ids based on the API key's permissions.
 * If agent_ids is empty, the key has access to all agents.
 */
export function getAgentFilter(apiKey: ExternalApiKey): string[] | null {
  if (apiKey.agent_ids.length === 0) return null; // all agents
  return apiKey.agent_ids;
}
