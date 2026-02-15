import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';

/**
 * POST /api/migrate/add-followup-sent
 * One-time migration: backfills followup_sent for existing leads.
 * The column must be added via Supabase SQL editor first:
 *   ALTER TABLE interested_leads ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT FALSE;
 * Then call this endpoint to backfill existing data.
 */
export async function POST() {
  try {
    // Backfill: set followup_sent=true for leads that already have a response sent
    const { data, error } = await supabaseAdmin
      .from('interested_leads')
      // @ts-ignore - followup_sent column added via migration
      .update({ followup_sent: true })
      .not('last_response_sent', 'is', null)
      .select('id');

    if (error) {
      return NextResponse.json({
        success: false,
        error: error.message,
        note: 'Run this SQL in Supabase SQL editor first: ALTER TABLE interested_leads ADD COLUMN IF NOT EXISTS followup_sent BOOLEAN DEFAULT FALSE;',
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Backfill completed',
      updated: data?.length || 0,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message,
    }, { status: 500 });
  }
}
