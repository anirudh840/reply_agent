import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';

/**
 * GET /api/debug/database
 * Debug endpoint to check database contents
 */
export async function GET(request: NextRequest) {
  try {
    // Count agents
    const { count: agentsCount } = await supabaseAdmin
      .from('agents')
      .select('*', { count: 'exact', head: true });

    // Count replies
    const { count: repliesCount } = await supabaseAdmin
      .from('replies')
      .select('*', { count: 'exact', head: true });

    // Count interested leads
    const { count: leadsCount } = await supabaseAdmin
      .from('interested_leads')
      .select('*', { count: 'exact', head: true });

    // Get sample of recent replies
    const { data: recentReplies } = await supabaseAdmin
      .from('replies')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get sample of recent interested leads
    const { data: recentLeads } = await supabaseAdmin
      .from('interested_leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    // Get all agents
    const { data: agents } = await supabaseAdmin.from('agents').select('id, name, is_active');

    // Check for replies that should have created interested leads but didn't
    const { data: interestedRepliesWithoutLeads } = await supabaseAdmin
      .from('replies')
      .select('id, lead_email, is_truly_interested, created_at')
      .eq('is_truly_interested', true)
      .order('created_at', { ascending: false })
      .limit(10);

    // For each reply, check if there's a corresponding lead
    const orphanedReplies = [];
    if (interestedRepliesWithoutLeads) {
      for (const reply of interestedRepliesWithoutLeads) {
        const { data: lead } = await supabaseAdmin
          .from('interested_leads')
          .select('id')
          .eq('initial_reply_id', reply.id)
          .maybeSingle();

        if (!lead) {
          orphanedReplies.push(reply);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        counts: {
          agents: agentsCount,
          replies: repliesCount,
          interested_leads: leadsCount,
        },
        agents,
        recent_replies: recentReplies,
        recent_leads: recentLeads,
        orphaned_interested_replies: orphanedReplies,
        diagnosis: {
          has_agents: (agentsCount || 0) > 0,
          has_replies: (repliesCount || 0) > 0,
          has_leads: (leadsCount || 0) > 0,
          has_orphaned_replies: orphanedReplies.length > 0,
        },
      },
    });
  } catch (error: any) {
    console.error('Error in debug endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to check database',
      },
      { status: 500 }
    );
  }
}
