'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  RefreshCw,
  TrendingUp,
  Mail,
  CheckCircle,
  XCircle,
  AlertCircle,
  Reply,
  Clock,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { ChartDataPoint } from '@/lib/types';

interface Metrics {
  total_replies: number;
  interested_replies: number;
  automated_replies: number;
  needs_approval: number;
  auto_responded: number;
  followup_sent: number;
  ooo_replies: number;
  errors: number;
  false_positives: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);

      const response = await fetch(`/api/dashboard/metrics?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        setMetrics(data.data.metrics);
        setChartData(data.data.chart_data || []);
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, [dateFrom, dateTo]);

  const metricCards = [
    {
      title: 'Total Replies',
      value: metrics?.total_replies || 0,
      icon: Mail,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
    {
      title: 'Interested Leads',
      value: metrics?.interested_replies || 0,
      icon: TrendingUp,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'Followup Sent',
      value: metrics?.followup_sent || 0,
      icon: Reply,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      title: 'Needs Approval',
      value: metrics?.needs_approval || 0,
      icon: AlertCircle,
      color: 'text-yellow-600',
      bg: 'bg-yellow-50',
    },
    {
      title: 'Auto Responded',
      value: metrics?.auto_responded || 0,
      icon: CheckCircle,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      title: 'OOO Replies',
      value: metrics?.ooo_replies || 0,
      icon: Clock,
      color: 'text-purple-600',
      bg: 'bg-purple-50',
    },
    {
      title: 'Automated Replies',
      value: metrics?.automated_replies || 0,
      icon: Mail,
      color: 'text-gray-600',
      bg: 'bg-gray-50',
    },
    {
      title: 'Errors',
      value: metrics?.errors || 0,
      icon: XCircle,
      color: 'text-red-600',
      bg: 'bg-red-50',
    },
  ];

  // Format chart date labels
  const formattedChartData = chartData.map((d) => ({
    ...d,
    date: new Date(d.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-gray-600">
            Overview of your email reply automation
          </p>
        </div>
        <Button onClick={fetchMetrics} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
          Refresh
        </Button>
      </div>

      {loading && !metrics ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Metrics Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {metricCards.map((metric) => (
              <Card key={metric.title} className="overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-gray-600">
                    {metric.title}
                  </CardTitle>
                  <div className={cn('rounded-lg p-2', metric.bg)}>
                    <metric.icon className={cn('h-4 w-4', metric.color)} />
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metric.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Response Trends Chart */}
          <Card className="mt-8">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Response Trends</CardTitle>
                  <p className="text-sm text-gray-500 mt-1">
                    Positive responses, OOO responses, and total responses over time
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-600">From</label>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-gray-600">To</label>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="px-2 py-1.5 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  {(dateFrom || dateTo) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDateFrom('');
                        setDateTo('');
                      }}
                      className="text-xs h-8"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {formattedChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={360}>
                  <LineChart data={formattedChartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12, fill: '#6b7280' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e5e7eb' }}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: '#6b7280' }}
                      tickLine={false}
                      axisLine={{ stroke: '#e5e7eb' }}
                      allowDecimals={false}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        fontSize: '13px',
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: '13px', paddingTop: '16px' }}
                    />
                    <Line
                      type="monotone"
                      dataKey="total_responses"
                      name="Total Responses"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#3b82f6' }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="positive_responses"
                      name="Positive Responses"
                      stroke="#22c55e"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#22c55e' }}
                      activeDot={{ r: 6 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="ooo_responses"
                      name="OOO Responses"
                      stroke="#a855f7"
                      strokeWidth={2.5}
                      dot={{ r: 4, fill: '#a855f7' }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-64 items-center justify-center">
                  <div className="text-center">
                    <TrendingUp className="mx-auto mb-3 h-10 w-10 text-gray-300" />
                    <p className="text-sm text-gray-500">
                      No response data available for the selected period
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {metrics && metrics.total_replies === 0 && (
            <Card className="mt-8">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Mail className="mb-4 h-12 w-12 text-gray-400" />
                <h3 className="mb-2 text-lg font-semibold">No replies yet</h3>
                <p className="mb-4 text-center text-gray-600">
                  Get started by creating an agent and syncing your EmailBison
                  replies
                </p>
                <Button asChild>
                  <a href="/agents">Create Agent</a>
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
