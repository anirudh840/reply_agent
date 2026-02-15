import { NextRequest, NextResponse } from 'next/server';
import { getInterestedLeads, updateInterestedLead } from '@/lib/supabase/queries';

/**
 * GET /api/leads
 * List interested leads with filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    // Parse agent_ids filter
    const agentIdsParam = searchParams.get('agent_ids');
    const agentIds = agentIdsParam ? agentIdsParam.split(',').filter(Boolean) : undefined;

    // Parse date range
    const dateFrom = searchParams.get('date_from') || undefined;
    const dateTo = searchParams.get('date_to') || undefined;

    const filters = {
      agent_ids: agentIds,
      conversation_status: searchParams.get('conversation_status') || undefined,
      needs_approval:
        searchParams.get('needs_approval') === 'true'
          ? true
          : searchParams.get('needs_approval') === 'false'
          ? false
          : undefined,
      date_from: dateFrom,
      date_to: dateTo,
      limit: parseInt(searchParams.get('limit') || '100'),
      offset: parseInt(searchParams.get('offset') || '0'),
    };

    // If agent_ids is an empty array, return no leads
    if (agentIds && agentIds.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        total: 0,
        page: 1,
        per_page: filters.limit,
        total_pages: 0,
      });
    }

    const { data, count } = await getInterestedLeads(filters);

    return NextResponse.json({
      success: true,
      data,
      total: count,
      page: Math.floor(filters.offset / filters.limit) + 1,
      per_page: filters.limit,
      total_pages: Math.ceil(count / filters.limit),
    });
  } catch (error: any) {
    console.error('Error fetching leads:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch leads',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/leads
 * Update a lead (e.g., reassign agent_id)
 * Body: { lead_id: string, updates: { agent_id?: string, ... } }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { lead_id, updates } = body;

    if (!lead_id || !updates) {
      return NextResponse.json(
        { success: false, error: 'lead_id and updates are required' },
        { status: 400 }
      );
    }

    const updatedLead = await updateInterestedLead(lead_id, updates);

    return NextResponse.json({
      success: true,
      data: updatedLead,
    });
  } catch (error: any) {
    console.error('Error updating lead:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update lead',
      },
      { status: 500 }
    );
  }
}
