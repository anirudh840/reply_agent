'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, RefreshCw, Settings, Pause, Play, Trash2 } from 'lucide-react';
import { formatDate } from '@/lib/utils';
import { PLATFORM_DISPLAY_NAMES } from '@/lib/constants';
import type { Agent } from '@/lib/types';

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllAgents, setShowAllAgents] = useState(true); // Show all by default

  const fetchAgents = async () => {
    try {
      setLoading(true);
      // Fetch all agents (both active and inactive)
      const response = await fetch(`/api/agents?active_only=${!showAllAgents}`);
      const data = await response.json();

      if (data.success) {
        setAgents(data.data);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
      alert('Failed to fetch agents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, [showAllAgents]);

  const toggleAgent = async (agentId: string, isActive: boolean) => {
    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      });

      const data = await response.json();

      if (data.success) {
        // Update the local state instead of refetching
        setAgents(agents.map(agent =>
          agent.id === agentId ? { ...agent, is_active: !isActive } : agent
        ));
      } else {
        alert(data.error || 'Failed to toggle agent');
      }
    } catch (error) {
      console.error('Error toggling agent:', error);
      alert('Failed to toggle agent. Please try again.');
    }
  };

  const deleteAgent = async (agentId: string, agentName: string) => {
    if (!confirm(`Are you sure you want to delete "${agentName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (data.success) {
        // Remove from local state
        setAgents(agents.filter(agent => agent.id !== agentId));
        alert('Agent deleted successfully');
      } else {
        alert(data.error || 'Failed to delete agent');
      }
    } catch (error) {
      console.error('Error deleting agent:', error);
      alert('Failed to delete agent. Please try again.');
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Agents</h1>
          <p className="text-gray-600">
            Manage your reply automation agents
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => setShowAllAgents(!showAllAgents)}
            variant="outline"
          >
            {showAllAgents ? 'Show Active Only' : 'Show All'}
          </Button>
          <Button onClick={fetchAgents} variant="outline" disabled={loading}>
            <RefreshCw className={cn('h-4 w-4', loading ? 'animate-spin' : '')} />
            Refresh
          </Button>
          <Button asChild>
            <a href="/agents/new">
              <Plus className="h-4 w-4" />
              Create Agent
            </a>
          </Button>
        </div>
      </div>

      {loading && agents.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      ) : agents.length === 0 ? (
        <Card className="p-12 text-center">
          <Settings className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <h3 className="mb-2 text-lg font-semibold">No agents yet</h3>
          <p className="mb-4 text-gray-600">
            Create your first reply automation agent to get started
          </p>
          <Button asChild>
            <a href="/agents/new">
              <Plus className="h-4 w-4" />
              Create Agent
            </a>
          </Button>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {agents.map((agent) => (
            <Card key={agent.id} className={!agent.is_active ? 'opacity-60' : ''}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="mb-2">{agent.name}</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant={agent.is_active ? 'default' : 'secondary'}>
                        {agent.is_active ? 'Active' : 'Paused'}
                      </Badge>
                      <Badge variant="outline">
                        {agent.mode === 'fully_automated'
                          ? 'Fully Automated'
                          : 'Human in Loop'}
                      </Badge>
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                        {PLATFORM_DISPLAY_NAMES[agent.platform || 'emailbison'] || 'EmailBison'}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="text-sm">
                    <span className="text-gray-600">Timezone:</span>{' '}
                    <span className="font-medium">{agent.timezone}</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-gray-600">Confidence Threshold:</span>{' '}
                    <span className="font-medium">{agent.confidence_threshold}/10</span>
                  </div>
                  {agent.last_sync_at && (
                    <div className="text-sm">
                      <span className="text-gray-600">Last Synced:</span>{' '}
                      <span className="font-medium">
                        {formatDate(agent.last_sync_at)}
                      </span>
                    </div>
                  )}

                  <div className="flex gap-2 pt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toggleAgent(agent.id, agent.is_active)}
                    >
                      {agent.is_active ? (
                        <>
                          <Pause className="h-4 w-4" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          Activate
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      asChild
                    >
                      <a href={`/agents/${agent.id}/configure`}>
                        <Settings className="h-4 w-4" />
                        Configure
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => deleteAgent(agent.id, agent.name)}
                      className="text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
