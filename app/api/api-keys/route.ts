import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';
import { generateApiKey } from '@/lib/api-auth';

// GET /api/api-keys - List all active API keys (internal use from dashboard)
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('external_api_keys')
      .select('id, name, key_prefix, agent_ids, scopes, created_at, last_used_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

// POST /api/api-keys - Create a new API key (internal use from dashboard)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, agent_ids = [], scopes = ['read:campaigns', 'read:leads'] } = body;

    if (!name) {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const { data, error } = await (supabaseAdmin
      .from('external_api_keys') as any)
      .insert({
        name,
        key_hash: keyHash,
        key_prefix: keyPrefix,
        agent_ids,
        scopes,
      })
      .select('id, name, key_prefix, agent_ids, scopes, created_at')
      .single();

    if (error) throw error;

    // Return the raw key ONCE - it cannot be retrieved again
    return NextResponse.json({
      success: true,
      data: {
        ...(data as any),
        api_key: rawKey, // Only returned on creation
      },
      message: 'Save this API key - it will not be shown again.',
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
