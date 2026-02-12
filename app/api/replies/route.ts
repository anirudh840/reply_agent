import { NextRequest, NextResponse } from 'next/server';
import { getReplies } from '@/lib/supabase/queries';

/**
 * GET /api/replies
 * List all replies with filters
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;

    const filters = {
      agent_id: searchParams.get('agent_id') || undefined,
      processing_status: searchParams.get('processing_status') || undefined,
      corrected_status: searchParams.get('corrected_status') || undefined,
      is_truly_interested:
        searchParams.get('is_truly_interested') === 'true'
          ? true
          : searchParams.get('is_truly_interested') === 'false'
          ? false
          : undefined,
      limit: parseInt(searchParams.get('limit') || '20'),
      offset: parseInt(searchParams.get('offset') || '0'),
    };

    const { data, count } = await getReplies(filters);

    return NextResponse.json({
      success: true,
      data,
      total: count,
      page: Math.floor(filters.offset / filters.limit) + 1,
      per_page: filters.limit,
      total_pages: Math.ceil(count / filters.limit),
    });
  } catch (error: any) {
    console.error('Error fetching replies:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch replies',
      },
      { status: 500 }
    );
  }
}
