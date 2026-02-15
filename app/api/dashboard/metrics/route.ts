import { NextRequest, NextResponse } from 'next/server';
import { getDashboardMetrics, getChartData } from '@/lib/supabase/queries';

/**
 * GET /api/dashboard/metrics
 * Get dashboard metrics
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const agentId = searchParams.get('agent_id') || undefined;
    const dateFrom = searchParams.get('date_from') || undefined;
    const dateTo = searchParams.get('date_to') || undefined;

    const [metrics, chartData] = await Promise.all([
      getDashboardMetrics(agentId),
      getChartData(agentId, dateFrom, dateTo),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        metrics,
        chart_data: chartData,
      },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard metrics:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch dashboard metrics',
      },
      { status: 500 }
    );
  }
}
