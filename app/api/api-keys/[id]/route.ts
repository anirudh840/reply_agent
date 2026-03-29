import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';

// DELETE /api/api-keys/[id] - Revoke an API key
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const { data, error } = await (supabaseAdmin
      .from('external_api_keys') as any)
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null)
      .select('id, name')
      .single();

    if (error || !data) {
      return NextResponse.json(
        { success: false, error: 'API key not found or already revoked' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data, message: 'API key revoked.' });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
