'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, TrendingUp, Mail, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface Metrics {
  total_replies: number;
  interested_replies: number;
  automated_replies: number;
  needs_approval: number;
  auto_responded: number;
  errors: number;
  false_positives: number;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/dashboard/metrics');
      const data = await response.json();

      if (data.success) {
        setMetrics(data.data.metrics);
      }
    } catch (error) {
      console.error('Error fetching metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
  }, []);

  const metricCards = [
    {
      title: 'Total Replies',
      value: metrics?.total_replies || 0,
      icon: Mail,
      color: 'text-blue-600',
    },
    {
      title: 'Interested Leads',
      value: metrics?.interested_replies || 0,
      icon: TrendingUp,
      color: 'text-green-600',
    },
    {
      title: 'Needs Approval',
      value: metrics?.needs_approval || 0,
      icon: AlertCircle,
      color: 'text-yellow-600',
    },
    {
      title: 'Auto Responded',
      value: metrics?.auto_responded || 0,
      icon: CheckCircle,
      color: 'text-green-600',
    },
    {
      title: 'Automated Replies',
      value: metrics?.automated_replies || 0,
      icon: Mail,
      color: 'text-gray-600',
    },
    {
      title: 'Errors',
      value: metrics?.errors || 0,
      icon: XCircle,
      color: 'text-red-600',
    },
  ];

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
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {loading && !metrics ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {metricCards.map((metric) => (
              <Card key={metric.title}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {metric.title}
                  </CardTitle>
                  <metric.icon className={cn('h-4 w-4', metric.color)} />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{metric.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

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
