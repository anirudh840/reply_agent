'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle } from 'lucide-react';

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  agent_ids: string[];
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/api-keys');
      const json = await res.json();
      if (json.success) setKeys(json.data || []);
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  const createKey = async () => {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setNewKeyRevealed(json.data.api_key);
        setNewKeyName('');
        fetchKeys();
      }
    } catch (err) {
      console.error('Failed to create API key:', err);
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (id: string) => {
    if (!confirm('Revoke this API key? Any apps using it will lose access.')) return;
    try {
      await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      fetchKeys();
    } catch (err) {
      console.error('Failed to revoke API key:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">API Keys</h1>
        <p className="text-gray-500 mt-1">
          Create API keys to let external apps access your responded leads and campaign metrics.
        </p>
      </div>

      {/* Create New Key */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Create New API Key</CardTitle>
          <CardDescription>
            The key will only be shown once. Store it securely.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="flex-1">
              <Label htmlFor="key-name" className="sr-only">Key name</Label>
              <Input
                id="key-name"
                placeholder="Key name (e.g. Dashboard App, Metrics Tracker)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && createKey()}
              />
            </div>
            <Button onClick={createKey} disabled={creating || !newKeyName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Create Key
            </Button>
          </div>

          {/* Revealed key (shown once after creation) */}
          {newKeyRevealed && (
            <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm font-medium text-yellow-800">
                  Copy this key now - it won't be shown again
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-white border rounded text-sm font-mono break-all">
                  {newKeyRevealed}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(newKeyRevealed)}
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-yellow-700"
                onClick={() => setNewKeyRevealed(null)}
              >
                I've saved it, dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Keys List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : keys.length === 0 ? (
            <p className="text-gray-500 text-sm">No API keys yet. Create one above.</p>
          ) : (
            <div className="space-y-3">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <Key className="h-4 w-4 text-gray-400" />
                    <div>
                      <div className="font-medium text-sm">{key.name}</div>
                      <div className="text-xs text-gray-500 font-mono">{key.key_prefix}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right text-xs text-gray-500">
                      <div>Created {new Date(key.created_at).toLocaleDateString()}</div>
                      {key.last_used_at && (
                        <div>Last used {new Date(key.last_used_at).toLocaleDateString()}</div>
                      )}
                    </div>
                    <div className="flex gap-1">
                      {key.scopes.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revokeKey(key.id)}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* API Documentation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">API Usage</CardTitle>
          <CardDescription>
            Use these endpoints from your external dashboard to fetch real positive metrics.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-medium text-sm mb-1">Authentication</h3>
            <code className="block p-2 bg-gray-50 border rounded text-xs font-mono">
              Authorization: Bearer eb_live_xxxxxxxxxxxxxxxx...
            </code>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">Campaign Metrics (positives per campaign)</h3>
            <code className="block p-2 bg-gray-50 border rounded text-xs font-mono">
              GET /api/v1/campaigns/metrics?since=2024-01-01&until=2024-12-31
            </code>
            <p className="text-xs text-gray-500 mt-1">
              Returns <code>responded_count</code> per campaign - leads that were actually replied to (real positives).
              Also includes <code>interested_count</code> (AI-classified) and <code>meetings_booked</code>.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-1">Responded Leads (detailed list)</h3>
            <code className="block p-2 bg-gray-50 border rounded text-xs font-mono">
              GET /api/v1/leads/responded?campaign_id=xxx&page=1&per_page=50
            </code>
            <p className="text-xs text-gray-500 mt-1">
              Returns paginated list of leads that received a response, with campaign info, timestamps,
              and conversation status.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-sm mb-2">Filter Parameters</h3>
            <table className="w-full text-xs border">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left p-2 border-b">Param</th>
                  <th className="text-left p-2 border-b">Description</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className="p-2 border-b font-mono">agent_id</td><td className="p-2 border-b">Filter to a specific agent</td></tr>
                <tr><td className="p-2 border-b font-mono">campaign_id</td><td className="p-2 border-b">Filter to a specific campaign (leads endpoint only)</td></tr>
                <tr><td className="p-2 border-b font-mono">since</td><td className="p-2 border-b">ISO date - only include data after this date</td></tr>
                <tr><td className="p-2 border-b font-mono">until</td><td className="p-2 border-b">ISO date - only include data before this date</td></tr>
                <tr><td className="p-2 border-b font-mono">status</td><td className="p-2 border-b">Conversation status: active, completed, paused, unresponsive</td></tr>
                <tr><td className="p-2 font-mono">page / per_page</td><td className="p-2">Pagination (max 200 per page)</td></tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
