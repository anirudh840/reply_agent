'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Loader2, Save } from 'lucide-react';
import type { Agent } from '@/lib/types';

export default function ConfigureAgentPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [confidenceThreshold, setConfidenceThreshold] = useState(6.0);
  const [timezone, setTimezone] = useState('UTC');

  useEffect(() => {
    if (agentId) {
      fetchAgent();
    }
  }, [agentId]);

  const fetchAgent = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/agents/${agentId}`);
      const data = await response.json();

      if (data.success) {
        setAgent(data.data);
        setName(data.data.name);
        setConfidenceThreshold(data.data.confidence_threshold);
        setTimezone(data.data.timezone);
      } else {
        alert('Failed to load agent');
        router.push('/agents');
      }
    } catch (error) {
      console.error('Error fetching agent:', error);
      alert('Failed to load agent');
      router.push('/agents');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          confidence_threshold: confidenceThreshold,
          timezone,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert('Agent updated successfully');
        router.push('/agents');
      } else {
        alert(data.error || 'Failed to update agent');
      }
    } catch (error) {
      console.error('Error updating agent:', error);
      alert('Failed to update agent');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  return (
    <div className="p-8">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4" />
        Back to Agents
      </Button>

      <div className="max-w-2xl">
        <h1 className="mb-2 text-3xl font-bold">Configure Agent</h1>
        <p className="mb-8 text-gray-600">
          Update settings for {agent.name}
        </p>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Basic Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">Agent Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Agent name"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Timezone</label>
                <Input
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  placeholder="UTC"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">
                  Confidence Threshold (0-10)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  step="0.1"
                  value={confidenceThreshold}
                  onChange={(e) =>
                    setConfidenceThreshold(parseFloat(e.target.value))
                  }
                />
                <p className="mt-1 text-xs text-gray-500">
                  Responses above this score will be auto-sent in Fully Automated mode
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Agent Mode</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md bg-gray-50 p-4">
                <p className="text-sm font-medium">
                  Current Mode:{' '}
                  <span className="text-primary">
                    {agent.mode === 'fully_automated'
                      ? 'Fully Automated'
                      : 'Human in Loop'}
                  </span>
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Mode cannot be changed after creation. Create a new agent to use a
                  different mode.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saving} className="flex-1">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <Save className="h-4 w-4" />
              Save Changes
            </Button>
            <Button variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
