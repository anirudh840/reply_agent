'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  RefreshCw,
  Search,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
  Edit3,
  User,
  Building2,
  Calendar,
  ChevronDown,
  X,
  Info,
  Target,
  BarChart3,
  Paperclip,
  Upload,
  Loader2,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import type { InterestedLead, Agent } from '@/lib/types';
import { RichTextEditor } from '@/components/inbox/RichTextEditor';
import { toast, Toaster } from 'react-hot-toast';

export default function InboxPage() {
  const [leads, setLeads] = useState<InterestedLead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedLead, setSelectedLead] = useState<InterestedLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Filter states
  const [leadStatusFilter, setLeadStatusFilter] = useState<string[]>([]);
  const [agentStatusFilter, setAgentStatusFilter] = useState<string[]>([]);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string[]>([]);
  const [intentFilter, setIntentFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [searchQuery, setSearchQuery] = useState('');

  // Message states
  const [messageToSend, setMessageToSend] = useState('');
  const [isEditingResponse, setIsEditingResponse] = useState(false);

  // Email composition states
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [ccRecipients, setCcRecipients] = useState<string[]>([]);
  const [bccRecipients, setBccRecipients] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [attachments, setAttachments] = useState<Array<{
    filename: string;
    url: string;
    contentType: string;
    size: number;
  }>>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchAgents();
    fetchLeads();
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [leadStatusFilter, agentStatusFilter, selectedAgentFilter, intentFilter, dateRange]);

  const fetchAgents = async () => {
    try {
      const response = await fetch('/api/agents?active_only=false');
      const data = await response.json();
      if (data.success) {
        setAgents(data.data);
      }
    } catch (error) {
      console.error('Error fetching agents:', error);
    }
  };

  const fetchLeads = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();

      // Apply agent status filters
      if (agentStatusFilter.includes('needs_approval')) params.set('needs_approval', 'true');

      // Apply agent filter
      if (selectedAgentFilter.length > 0) {
        params.set('agent_ids', selectedAgentFilter.join(','));
      }

      // Apply date range
      if (dateRange.from) params.set('date_from', dateRange.from);
      if (dateRange.to) params.set('date_to', dateRange.to);

      const response = await fetch(`/api/leads?${params.toString()}`);
      const data = await response.json();

      if (data.success) {
        let filteredLeads = data.data;

        // Client-side filtering for additional criteria
        if (searchQuery) {
          filteredLeads = filteredLeads.filter(
            (lead: InterestedLead) =>
              lead.lead_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
              lead.lead_email.toLowerCase().includes(searchQuery.toLowerCase()) ||
              lead.lead_company?.toLowerCase().includes(searchQuery.toLowerCase())
          );
        }

        // Filter by agent status (ai_responded)
        if (agentStatusFilter.includes('ai_responded')) {
          filteredLeads = filteredLeads.filter(
            (lead: InterestedLead) => lead.last_response_sent && !lead.needs_approval
          );
        }

        // Filter by error status (if we add error tracking later)
        if (agentStatusFilter.includes('error')) {
          filteredLeads = filteredLeads.filter(
            (lead: InterestedLead) => lead.conversation_status === 'paused'
          );
        }

        // Filter by intent category
        if (intentFilter !== 'all') {
          switch (intentFilter) {
            case 'high_confidence':
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => (lead.response_confidence_score || 0) >= 7
              );
              break;
            case 'medium_confidence':
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => {
                  const score = lead.response_confidence_score || 0;
                  return score >= 4 && score < 7;
                }
              );
              break;
            case 'low_confidence':
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => (lead.response_confidence_score || 0) < 4
              );
              break;
          }
        }

        setLeads(filteredLeads);

        // Auto-select first lead if none selected
        if (!selectedLead && filteredLeads.length > 0) {
          handleSelectLead(filteredLeads[0]);
        }
      }
    } catch (error) {
      console.error('Error fetching leads:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectLead = (lead: InterestedLead) => {
    setSelectedLead(lead);
    // Only set message if lead needs approval
    if (lead.needs_approval && lead.last_response_generated) {
      setMessageToSend(lead.last_response_generated);
    } else {
      setMessageToSend('');
    }
    setIsEditingResponse(false);
  };

  const handleSendMessage = async () => {
    if (!selectedLead || !messageToSend.trim()) return;

    setSending(true);
    try {
      const response = await fetch('/api/leads/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          message: messageToSend,
          cc: ccRecipients,
          bcc: bccRecipients,
          attachments: attachments,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Message sent successfully!');
        setMessageToSend('');
        setCcRecipients([]);
        setBccRecipients([]);
        setAttachments([]);
        setShowCcBcc(false);
        fetchLeads();
      } else {
        toast.error(`Failed to send: ${data.error}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleApproveAndSend = async () => {
    if (!selectedLead) return;

    setSending(true);
    try {
      const response = await fetch('/api/leads/approve-and-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          message: messageToSend,
          cc: ccRecipients,
          bcc: bccRecipients,
          attachments: attachments,
        }),
      });

      const data = await response.json();

      if (data.success) {
        toast.success('Response approved and sent!');
        setMessageToSend('');
        setCcRecipients([]);
        setBccRecipients([]);
        setAttachments([]);
        setShowCcBcc(false);
        fetchLeads();
      } else {
        toast.error(`Failed to send: ${data.error}`);
      }
    } catch (error) {
      console.error('Error approving message:', error);
      toast.error('Failed to approve and send');
    } finally {
      setSending(false);
    }
  };

  const toggleFilter = (filterArray: string[], setFilter: Function, value: string) => {
    if (filterArray.includes(value)) {
      setFilter(filterArray.filter((v) => v !== value));
    } else {
      setFilter([...filterArray, value]);
    }
  };

  const getStatusBadge = (lead: InterestedLead) => {
    if (lead.needs_approval) {
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertCircle className="mr-1 h-3 w-3" />
          Needs Approval
        </Badge>
      );
    }

    if (lead.last_response_sent) {
      return (
        <Badge variant="default" className="text-xs bg-green-600">
          <CheckCircle className="mr-1 h-3 w-3" />
          AI Responded
        </Badge>
      );
    }

    return (
      <Badge variant="secondary" className="text-xs">
        {lead.conversation_status}
      </Badge>
    );
  };

  const getAgent = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  const handleAddCcRecipient = () => {
    if (ccInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ccInput)) {
      if (!ccRecipients.includes(ccInput)) {
        setCcRecipients([...ccRecipients, ccInput]);
        setCcInput('');
      }
    } else {
      toast.error('Please enter a valid email address');
    }
  };

  const handleAddBccRecipient = () => {
    if (bccInput && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bccInput)) {
      if (!bccRecipients.includes(bccInput)) {
        setBccRecipients([...bccRecipients, bccInput]);
        setBccInput('');
      }
    } else {
      toast.error('Please enter a valid email address');
    }
  };

  const handleRemoveCcRecipient = (email: string) => {
    setCcRecipients(ccRecipients.filter((r) => r !== email));
  };

  const handleRemoveBccRecipient = (email: string) => {
    setBccRecipients(bccRecipients.filter((r) => r !== email));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setAttachments([...attachments, data.data]);
        toast.success('File uploaded successfully');
      } else {
        toast.error(data.error || 'Failed to upload file');
      }
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = (url: string) => {
    setAttachments(attachments.filter((a) => a.url !== url));
  };

  return (
    <>
      <Toaster position="top-right" />
      <div className="flex h-screen">
      {/* Left Sidebar - Filters & Lead List */}
      <div className="w-96 border-r border-gray-200 flex flex-col bg-gray-50">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <h1 className="text-xl font-bold mb-1">Master Inbox</h1>
          <p className="text-sm text-gray-600">{leads.length} leads</p>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-gray-200 bg-white">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search leads..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Filters */}
        <div className="p-3 border-b border-gray-200 bg-white overflow-y-auto max-h-64">
          {/* Agent Status Filter */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">
              Agent Status
            </label>
            <div className="flex flex-wrap gap-1">
              {['needs_approval', 'ai_responded', 'error'].map((status) => (
                <button
                  key={status}
                  onClick={() => toggleFilter(agentStatusFilter, setAgentStatusFilter, status)}
                  className={`px-2 py-1 text-xs rounded-md border capitalize ${
                    agentStatusFilter.includes(status)
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Intent Filter */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">
              Lead Intent
            </label>
            <select
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value)}
              className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md bg-white"
            >
              <option value="all">All Leads</option>
              <option value="high_confidence">High Confidence (7-10)</option>
              <option value="medium_confidence">Medium Confidence (4-6)</option>
              <option value="low_confidence">Low Confidence (0-3)</option>
            </select>
          </div>

          {/* Agent Filter */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">Agent</label>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {agents.map((agent) => (
                <label key={agent.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedAgentFilter.includes(agent.id)}
                    onChange={() =>
                      toggleFilter(selectedAgentFilter, setSelectedAgentFilter, agent.id)
                    }
                    className="rounded border-gray-300"
                  />
                  <span className="text-xs text-gray-700">{agent.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Date Range Filter */}
          <div className="mb-2">
            <label className="text-xs font-semibold text-gray-700 mb-2 block">Date Range</label>
            <div className="space-y-2">
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md"
                placeholder="From"
              />
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                className="w-full px-2 py-1 text-xs border border-gray-300 rounded-md"
                placeholder="To"
              />
            </div>
          </div>

          {/* Clear Filters */}
          {(leadStatusFilter.length > 0 ||
            agentStatusFilter.length > 0 ||
            selectedAgentFilter.length > 0 ||
            dateRange.from ||
            dateRange.to) && (
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs"
              onClick={() => {
                setLeadStatusFilter([]);
                setAgentStatusFilter([]);
                setSelectedAgentFilter([]);
                setDateRange({ from: '', to: '' });
              }}
            >
              <X className="h-3 w-3 mr-1" />
              Clear All Filters
            </Button>
          )}
        </div>

        {/* Leads List */}
        <div className="flex-1 overflow-y-auto">
          {loading && leads.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : leads.length === 0 ? (
            <div className="p-6 text-center">
              <Mail className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">No leads found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {leads.map((lead) => (
                <button
                  key={lead.id}
                  onClick={() => handleSelectLead(lead)}
                  className={`w-full p-3 text-left hover:bg-blue-50 transition-colors ${
                    selectedLead?.id === lead.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-start justify-between mb-1">
                    <h3 className="text-sm font-semibold text-gray-900 truncate">
                      {lead.lead_name || 'Unknown'}
                    </h3>
                    {getStatusBadge(lead)}
                  </div>

                  <p className="text-xs text-gray-600 truncate mb-1">{lead.lead_email}</p>

                  <div className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      {lead.conversation_thread.length}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(lead.updated_at)}
                    </span>
                  </div>

                  {lead.needs_approval && (
                    <Badge variant="destructive" className="mt-2 text-xs">
                      Confidence: {lead.response_confidence_score}/10
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Refresh Button */}
        <div className="p-3 border-t border-gray-200 bg-white">
          <Button onClick={fetchLeads} disabled={loading} className="w-full" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh Leads
          </Button>
        </div>
      </div>

      {/* Right Panel - Conversation & Actions */}
      <div className="flex-1 flex flex-col bg-white">
        {!selectedLead ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Mail className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No lead selected</h3>
              <p className="text-gray-500">Select a lead from the list to view details</p>
            </div>
          </div>
        ) : (
          <>
            {/* Lead Header with Info Panel */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-xl font-bold text-gray-900 mb-1">
                    {selectedLead.lead_name || 'Unknown Lead'}
                  </h2>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span className="flex items-center gap-1">
                      <Mail className="h-4 w-4" />
                      {selectedLead.lead_email}
                    </span>
                    {selectedLead.lead_company && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-4 w-4" />
                        {selectedLead.lead_company}
                      </span>
                    )}
                  </div>
                </div>
                {getStatusBadge(selectedLead)}
              </div>

              {/* Lead Information Panel */}
              <div className="grid grid-cols-3 gap-4 p-4 bg-white rounded-lg border border-gray-200 mb-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Agent</p>
                  <p className="text-sm font-medium text-gray-900">
                    {getAgent(selectedLead.agent_id)?.name || 'Unknown'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Status</p>
                  <p className="text-sm font-medium text-gray-900 capitalize">
                    {selectedLead.conversation_status}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase">Messages</p>
                  <p className="text-sm font-medium text-gray-900">
                    {selectedLead.conversation_thread.length}
                  </p>
                </div>
                {selectedLead.needs_approval && (
                  <>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase">
                        AI Confidence
                      </p>
                      <p className="text-sm font-medium text-gray-900">
                        {selectedLead.response_confidence_score}/10
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-gray-500 uppercase">
                        Approval Status
                      </p>
                      <Badge variant="destructive" className="text-xs">
                        Awaiting Review
                      </Badge>
                    </div>
                  </>
                )}
                {selectedLead.last_response_sent_at && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase">Last Sent</p>
                    <p className="text-sm font-medium text-gray-900">
                      {formatRelativeTime(selectedLead.last_response_sent_at)}
                    </p>
                  </div>
                )}
              </div>

              {/* Intent Information Panel */}
              <div className="p-4 bg-white rounded-lg border border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                  <Target className="h-4 w-4 text-blue-600" />
                  <h3 className="text-sm font-semibold text-gray-900">Lead Intent Analysis</h3>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase">AI Confidence</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${
                            (selectedLead.response_confidence_score || 0) >= 7
                              ? 'bg-green-500'
                              : (selectedLead.response_confidence_score || 0) >= 4
                              ? 'bg-yellow-500'
                              : 'bg-red-500'
                          }`}
                          style={{
                            width: `${((selectedLead.response_confidence_score || 0) / 10) * 100}%`,
                          }}
                        />
                      </div>
                      <span className="text-sm font-bold text-gray-900">
                        {selectedLead.response_confidence_score || 0}/10
                      </span>
                    </div>
                    <Badge
                      variant={
                        (selectedLead.response_confidence_score || 0) >= 7
                          ? 'default'
                          : (selectedLead.response_confidence_score || 0) >= 4
                          ? 'secondary'
                          : 'destructive'
                      }
                      className="text-xs mt-1"
                    >
                      {(selectedLead.response_confidence_score || 0) >= 7
                        ? 'High Confidence'
                        : (selectedLead.response_confidence_score || 0) >= 4
                        ? 'Medium Confidence'
                        : 'Low Confidence'}
                    </Badge>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-500 uppercase">
                      Conversation Status
                    </p>
                    <Badge
                      variant={
                        selectedLead.conversation_status === 'active'
                          ? 'default'
                          : selectedLead.conversation_status === 'completed'
                          ? 'secondary'
                          : 'outline'
                      }
                      className="text-xs capitalize"
                    >
                      {selectedLead.conversation_status}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            {/* Conversation Thread */}
            <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
              <div className="max-w-3xl mx-auto space-y-4">
                {selectedLead.conversation_thread.map((message, index) => (
                  <div
                    key={index}
                    className={`flex ${message.role === 'lead' ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-2xl rounded-lg p-4 shadow-sm ${
                        message.role === 'lead'
                          ? 'bg-white border border-gray-200'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <User className="h-4 w-4" />
                        <span className="text-sm font-semibold">
                          {message.role === 'lead'
                            ? selectedLead.lead_name || 'Lead'
                            : 'You (AI Agent)'}
                        </span>
                        <span
                          className={`text-xs ${
                            message.role === 'lead' ? 'text-gray-500' : 'text-blue-100'
                          }`}
                        >
                          {new Date(message.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Message Composer */}
            <div className="p-4 border-t border-gray-200 bg-white">
              {/* AI Responded - Read Only */}
              {selectedLead.last_response_sent && !selectedLead.needs_approval ? (
                <div className="mb-3 p-4 bg-green-50 border border-green-200 rounded-md">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span className="text-sm font-semibold text-green-900">
                      AI Response Sent
                    </span>
                    <span className="text-xs text-green-700 ml-auto">
                      {new Date(selectedLead.last_response_sent_at!).toLocaleString()}
                    </span>
                  </div>
                  <div className="bg-white p-3 rounded border border-green-200 mt-2">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">
                      {selectedLead.last_response_sent}
                    </p>
                  </div>
                  <p className="text-xs text-green-700 mt-2">
                    This message was automatically sent by AI. You can send a new message below if needed.
                  </p>
                </div>
              ) : null}

              {/* Needs Approval - Editable */}
              {selectedLead.needs_approval && selectedLead.last_response_generated && (
                <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-yellow-900">
                      AI Generated Response (Confidence: {selectedLead.response_confidence_score}
                      /10)
                    </span>
                    {!isEditingResponse && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsEditingResponse(true)}
                      >
                        <Edit3 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* CC/BCC Toggle */}
              <div className="mb-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCcBcc(!showCcBcc)}
                  className="text-xs"
                >
                  {showCcBcc ? 'Hide' : 'Show'} CC/BCC
                </Button>
              </div>

              {/* CC/BCC Fields */}
              {showCcBcc && (
                <div className="space-y-3 mb-3">
                  {/* CC Field */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1 block">CC</label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="Add CC recipient..."
                        value={ccInput}
                        onChange={(e) => setCcInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddCcRecipient();
                          }
                        }}
                        className="text-sm"
                      />
                      <Button type="button" size="sm" onClick={handleAddCcRecipient}>
                        Add
                      </Button>
                    </div>
                    {ccRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ccRecipients.map((email) => (
                          <Badge key={email} variant="secondary" className="text-xs">
                            {email}
                            <button
                              onClick={() => handleRemoveCcRecipient(email)}
                              className="ml-1 hover:text-red-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* BCC Field */}
                  <div>
                    <label className="text-xs font-semibold text-gray-700 mb-1 block">BCC</label>
                    <div className="flex gap-2">
                      <Input
                        type="email"
                        placeholder="Add BCC recipient..."
                        value={bccInput}
                        onChange={(e) => setBccInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddBccRecipient();
                          }
                        }}
                        className="text-sm"
                      />
                      <Button type="button" size="sm" onClick={handleAddBccRecipient}>
                        Add
                      </Button>
                    </div>
                    {bccRecipients.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {bccRecipients.map((email) => (
                          <Badge key={email} variant="secondary" className="text-xs">
                            {email}
                            <button
                              onClick={() => handleRemoveBccRecipient(email)}
                              className="ml-1 hover:text-red-600"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Message Input - Rich Text Editor */}
              <div className="space-y-3">
                <RichTextEditor
                  content={messageToSend}
                  onChange={setMessageToSend}
                  placeholder={
                    selectedLead.last_response_sent && !selectedLead.needs_approval
                      ? 'Send a follow-up message...'
                      : 'Type your message...'
                  }
                />

                {/* File Attachments */}
                <div>
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="file-upload"
                      className="cursor-pointer inline-flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      {uploading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Paperclip className="h-4 w-4" />
                      )}
                      {uploading ? 'Uploading...' : 'Attach File'}
                    </label>
                    <input
                      id="file-upload"
                      type="file"
                      onChange={handleFileUpload}
                      disabled={uploading}
                      className="hidden"
                    />
                  </div>

                  {attachments.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {attachments.map((attachment) => (
                        <div
                          key={attachment.url}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-200"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <Paperclip className="h-4 w-4 text-gray-500 flex-shrink-0" />
                            <span className="text-sm text-gray-700 truncate">
                              {attachment.filename}
                            </span>
                            <span className="text-xs text-gray-500">
                              ({(attachment.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>
                          <button
                            onClick={() => handleRemoveAttachment(attachment.url)}
                            className="text-red-600 hover:text-red-700"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  {selectedLead.needs_approval ? (
                    <>
                      <Button
                        onClick={handleApproveAndSend}
                        disabled={sending || !messageToSend.trim()}
                        className="flex-1"
                      >
                        <CheckCircle className="h-4 w-4 mr-2" />
                        {sending ? 'Sending...' : 'Approve & Send'}
                      </Button>
                      <Button
                        onClick={handleSendMessage}
                        disabled={sending || !messageToSend.trim()}
                        variant="outline"
                      >
                        <Send className="h-4 w-4 mr-2" />
                        Send Different Message
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={handleSendMessage}
                      disabled={sending || !messageToSend.trim()}
                      className="flex-1"
                    >
                      <Send className="h-4 w-4 mr-2" />
                      {sending ? 'Sending...' : 'Send Message'}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
    </>
  );
}
