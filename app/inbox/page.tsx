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
  ChevronRight,
  X,
  Info,
  Inbox,
  ThumbsUp,
  ThumbsDown,
  Bot,
  UserCircle,
  Eye,
  EyeOff,
  Paperclip,
  Upload,
  Loader2,
} from 'lucide-react';
import { formatRelativeTime } from '@/lib/utils';
import type { InterestedLead, Agent } from '@/lib/types';
import { RichTextEditor } from '@/components/inbox/RichTextEditor';
import { toast, Toaster } from 'react-hot-toast';

type Category = 'all' | 'interested' | 'not_interested' | 'automated' | 'not_automated' | 'tracked' | 'untracked';

export default function InboxPage() {
  const [leads, setLeads] = useState<InterestedLead[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedLead, setSelectedLead] = useState<InterestedLead | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // Category navigation
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');

  // Filter states (removed intent filter)
  const [leadStatusFilter, setLeadStatusFilter] = useState<string[]>([]);
  const [agentStatusFilter, setAgentStatusFilter] = useState<string[]>([]);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string[]>([]);
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

  // Lead sidebar collapsed state
  const [leadSidebarCollapsed, setLeadSidebarCollapsed] = useState(false);

  // Thread display options
  const [threadOrder, setThreadOrder] = useState<'newest' | 'oldest'>('oldest');
  const [threadExpanded, setThreadExpanded] = useState(false);

  useEffect(() => {
    fetchAgents();
    fetchLeads();
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [leadStatusFilter, agentStatusFilter, selectedAgentFilter, selectedCategory, dateRange]);

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

        // Filter by category (based on EmailBison reply data)
        if (selectedCategory !== 'all') {
          switch (selectedCategory) {
            case 'interested':
              // Filter for truly interested leads
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_truly_interested === true
              );
              break;
            case 'not_interested':
              // Filter for not interested leads
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_truly_interested === false
              );
              break;
            case 'automated':
              // Filter for automated replies
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_automated_original === true
              );
              break;
            case 'not_automated':
              // Filter for non-automated replies
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_automated_original === false
              );
              break;
            case 'tracked':
              // Filter for tracked replies
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_tracked_original === true
              );
              break;
            case 'untracked':
              // Filter for untracked replies
              filteredLeads = filteredLeads.filter(
                (lead: InterestedLead) => lead.is_tracked_original === false
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

  // Get category counts
  const getCategoryCount = (category: Category): number => {
    if (category === 'all') return leads.length;

    switch (category) {
      case 'interested':
        return leads.filter((lead) => lead.is_truly_interested === true).length;
      case 'not_interested':
        return leads.filter((lead) => lead.is_truly_interested === false).length;
      case 'automated':
        return leads.filter((lead) => lead.is_automated_original === true).length;
      case 'not_automated':
        return leads.filter((lead) => lead.is_automated_original === false).length;
      case 'tracked':
        return leads.filter((lead) => lead.is_tracked_original === true).length;
      case 'untracked':
        return leads.filter((lead) => lead.is_tracked_original === false).length;
      default:
        return 0;
    }
  };

  // Category definitions
  const categories = [
    { id: 'all' as Category, label: 'All Inbox', icon: Inbox, color: 'text-gray-700' },
    { id: 'interested' as Category, label: 'Interested', icon: ThumbsUp, color: 'text-green-600' },
    { id: 'not_interested' as Category, label: 'Not Interested', icon: ThumbsDown, color: 'text-red-600' },
    { id: 'automated' as Category, label: 'Automated Reply', icon: Bot, color: 'text-purple-600' },
    { id: 'not_automated' as Category, label: 'Not Automated Reply', icon: UserCircle, color: 'text-blue-600' },
    { id: 'tracked' as Category, label: 'Tracked Reply', icon: Eye, color: 'text-indigo-600' },
    { id: 'untracked' as Category, label: 'Untracked Reply', icon: EyeOff, color: 'text-gray-600' },
  ];

  return (
    <>
      <Toaster position="top-right" />
      <div className="flex h-screen bg-gray-50">
      {/* LEFT PANEL - Categories & Filters (~20%) */}
      <div className="w-64 border-r border-gray-200 flex flex-col bg-white">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <h1 className="text-lg font-bold text-gray-900">Master Inbox</h1>
        </div>

        {/* Categories */}
        <div className="p-2">
          <div className="space-y-1">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => setSelectedCategory(category.id)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                  selectedCategory === category.id
                    ? 'bg-blue-50 text-blue-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <category.icon className={`h-4 w-4 ${selectedCategory === category.id ? 'text-blue-600' : category.color}`} />
                  <span>{category.label}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {getCategoryCount(category.id)}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="my-2 border-t border-gray-200" />

        {/* Filters Section */}
        <div className="px-4 py-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase mb-3">Filters</h2>

          {/* Lead Status Filter */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 mb-2 block">
              Lead Status
            </label>
            <div className="flex flex-wrap gap-1">
              {['active', 'completed', 'paused', 'unresponsive'].map((status) => (
                <button
                  key={status}
                  onClick={() => toggleFilter(leadStatusFilter, setLeadStatusFilter, status)}
                  className={`px-2 py-1 text-xs rounded-md border capitalize ${
                    leadStatusFilter.includes(status)
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Agent Status Filter */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 mb-2 block">
              Agent Status
            </label>
            <div className="flex flex-wrap gap-1">
              {['needs_approval', 'ai_responded'].map((status) => (
                <button
                  key={status}
                  onClick={() => toggleFilter(agentStatusFilter, setAgentStatusFilter, status)}
                  className={`px-2 py-1 text-xs rounded-md border capitalize ${
                    agentStatusFilter.includes(status)
                      ? 'bg-blue-100 border-blue-300 text-blue-700'
                      : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {/* Agent Filter */}
          <div className="mb-4">
            <label className="text-xs font-medium text-gray-700 mb-2 block">Agent</label>
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {agents.map((agent) => (
                <label key={agent.id} className="flex items-center gap-2 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={selectedAgentFilter.includes(agent.id)}
                    onChange={() =>
                      toggleFilter(selectedAgentFilter, setSelectedAgentFilter, agent.id)
                    }
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700">{agent.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Date Range Filter */}
          <div className="mb-3">
            <label className="text-xs font-medium text-gray-700 mb-2 block">Date Range</label>
            <div className="space-y-2">
              <input
                type="date"
                value={dateRange.from}
                onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md"
                placeholder="From"
              />
              <input
                type="date"
                value={dateRange.to}
                onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-md"
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
              Clear All
            </Button>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh Button */}
        <div className="p-3 border-t border-gray-200">
          <Button onClick={fetchLeads} disabled={loading} className="w-full" size="sm">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* MIDDLE PANEL - Conversation List (~35%) */}
      <div className="w-96 border-r border-gray-200 flex flex-col bg-white">
        {/* Search Bar */}
        <div className="p-3 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Search conversations..."
              className="pl-10 text-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loading && leads.length === 0 ? (
            <div className="flex h-32 items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : leads.length === 0 ? (
            <div className="p-6 text-center">
              <Mail className="mx-auto mb-3 h-10 w-10 text-gray-300" />
              <p className="text-sm text-gray-500">No conversations found</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {leads.map((lead) => {
                const lastMessage = lead.conversation_thread[lead.conversation_thread.length - 1];
                const isSelected = selectedLead?.id === lead.id;

                return (
                  <button
                    key={lead.id}
                    onClick={() => handleSelectLead(lead)}
                    className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                      isSelected ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                    }`}
                  >
                    {/* Lead Name & Status */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-gray-900 truncate">
                          {lead.lead_name || 'Unknown Lead'}
                        </h3>
                        <p className="text-xs text-gray-500 truncate">{lead.lead_email}</p>
                      </div>
                      <div className="ml-2 flex-shrink-0">
                        <span className="text-xs text-gray-400">
                          {formatRelativeTime(lead.updated_at)}
                        </span>
                      </div>
                    </div>

                    {/* Last Message Preview */}
                    <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                      {lastMessage?.content || 'No messages'}
                    </p>

                    {/* Status Badge and Message Count */}
                    <div className="flex items-center justify-between">
                      {getStatusBadge(lead)}
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {lead.conversation_thread.length}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* RIGHT PANEL - Thread View & Lead Sidebar (~45%) */}
      <div className="flex-1 flex bg-white">
        {!selectedLead ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Mail className="mx-auto mb-4 h-16 w-16 text-gray-300" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">No conversation selected</h3>
              <p className="text-gray-500">Select a conversation to view the thread</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex">
            {/* Thread View Section */}
            <div className={`flex flex-col transition-all ${leadSidebarCollapsed ? 'flex-1' : 'w-2/3'}`}>
              {/* Approval Banner */}
              {selectedLead.needs_approval && (
                <div className="p-4 bg-yellow-50 border-b border-yellow-200">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-semibold text-yellow-900 mb-1">
                          AI Response Pending Approval
                        </h3>
                        <p className="text-xs text-yellow-700">
                          AI confidence: {selectedLead.response_confidence_score}/10 - Please review and approve or edit the suggested response below.
                        </p>
                      </div>
                    </div>
                    <Badge variant="destructive" className="text-xs">
                      Action Required
                    </Badge>
                  </div>
                </div>
              )}

              {/* AI Responded Banner */}
              {selectedLead.last_response_sent && !selectedLead.needs_approval && (
                <div className="p-3 bg-green-50 border-b border-green-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-xs font-medium text-green-900">
                        AI response sent {formatRelativeTime(selectedLead.last_response_sent_at!)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Thread Header */}
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-gray-900 mb-1">
                      {selectedLead.lead_name || 'Unknown Lead'}
                    </h2>
                    <div className="flex items-center gap-3 text-sm text-gray-600">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLeadSidebarCollapsed(!leadSidebarCollapsed)}
                    className="text-xs"
                  >
                    {leadSidebarCollapsed ? (
                      <>
                        <ChevronRight className="h-4 w-4 mr-1" />
                        Show Details
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Hide Details
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Email Thread - Individual Email Cards */}
              <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
                {/* Thread Summary Bar */}
                <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="font-semibold text-gray-900">
                      {selectedLead.conversation_thread.length} {selectedLead.conversation_thread.length === 1 ? 'message' : 'messages'}
                    </span>
                    <span className="text-gray-500">•</span>
                    <span className="text-gray-600">
                      Started {formatRelativeTime(selectedLead.conversation_thread[0]?.timestamp || selectedLead.created_at)}
                    </span>
                    {selectedLead.conversation_thread.length > 1 && (
                      <>
                        <span className="text-gray-500">•</span>
                        <span className="text-gray-600">
                          Last reply {formatRelativeTime(selectedLead.conversation_thread[selectedLead.conversation_thread.length - 1]?.timestamp)}
                        </span>
                      </>
                    )}
                    <span className="text-gray-500">•</span>
                    <Badge variant={selectedLead.conversation_status === 'active' ? 'default' : 'secondary'} className="text-xs">
                      {selectedLead.conversation_status}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setThreadOrder(threadOrder === 'oldest' ? 'newest' : 'oldest')}
                    className="text-xs"
                  >
                    {threadOrder === 'oldest' ? 'Oldest First' : 'Newest First'}
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </div>

                {/* Thread Messages with Timeline */}
                <div className="relative">
                  {/* Timeline Connector */}
                  <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-300" />

                  <div className="space-y-3 relative">
                    {(() => {
                      // Sort messages based on order preference
                      const sortedMessages = threadOrder === 'oldest'
                        ? [...selectedLead.conversation_thread]
                        : [...selectedLead.conversation_thread].reverse();

                      // Handle collapse for long threads
                      const shouldCollapse = sortedMessages.length > 5 && !threadExpanded;
                      const displayMessages = shouldCollapse
                        ? [
                            ...sortedMessages.slice(0, 2),
                            null, // Placeholder for "show more" button
                            ...sortedMessages.slice(-2),
                          ]
                        : sortedMessages;

                      return displayMessages.map((message, index) => {
                        // Show "expand" button
                        if (message === null) {
                          return (
                            <div key="expand" className="flex justify-center py-2">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setThreadExpanded(true)}
                                className="text-xs"
                              >
                                Show {sortedMessages.length - 4} more messages
                              </Button>
                            </div>
                          );
                        }

                        const isLead = message.role === 'lead';

                        return (
                          <div key={index} className="flex gap-3 relative z-10">
                            {/* Timeline Node */}
                            <div className={`flex-shrink-0 h-12 w-12 rounded-full border-4 border-gray-50 flex items-center justify-center ${
                              isLead ? 'bg-blue-100' : 'bg-gray-200'
                            }`}>
                              {isLead ? (
                                <User className="h-5 w-5 text-blue-600" />
                              ) : (
                                <Bot className="h-5 w-5 text-gray-600" />
                              )}
                            </div>

                            {/* Message Card */}
                            <div className="flex-1">
                              <div className="rounded-lg border shadow-sm bg-white overflow-hidden">
                                {/* Colored Header */}
                                <div className={`p-3 ${isLead ? 'bg-blue-50' : 'bg-gray-50'}`}>
                                  <div className="flex items-start justify-between">
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className="text-sm font-semibold text-gray-900">
                                          {isLead ? 'From:' : 'From:'} {
                                            isLead
                                              ? selectedLead.lead_name || 'Lead'
                                              : getAgent(selectedLead.agent_id)?.name || 'AI Agent'
                                          }
                                        </span>
                                        <Badge variant={isLead ? 'default' : 'secondary'} className="text-xs">
                                          {isLead ? 'Inbound' : 'Outbound'}
                                        </Badge>
                                      </div>
                                      <div className="text-xs text-gray-600 space-y-0.5">
                                        <div>
                                          <span className="font-medium">To:</span> {
                                            isLead
                                              ? getAgent(selectedLead.agent_id)?.name || 'Agent'
                                              : selectedLead.lead_email
                                          }
                                        </div>
                                        <div>
                                          <span className="font-medium">Date:</span> {new Date(message.timestamp).toLocaleString('en-US', {
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                            hour: 'numeric',
                                            minute: '2-digit',
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>

                                {/* Message Body */}
                                <div className="p-4">
                                  <div className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
                                    {message.content}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>

                  {/* Show "Collapse" button if expanded */}
                  {threadExpanded && selectedLead.conversation_thread.length > 5 && (
                    <div className="flex justify-center py-3 mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setThreadExpanded(false)}
                        className="text-xs"
                      >
                        Collapse thread
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Message Composer */}
              <div className="p-4 border-t border-gray-200 bg-white">
                {/* AI Generated Response Notice */}
                {selectedLead.needs_approval && selectedLead.last_response_generated && !isEditingResponse && (
                  <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-blue-900">
                        AI Suggested Response (Confidence: {selectedLead.response_confidence_score}/10)
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setIsEditingResponse(true)}
                        className="text-xs"
                      >
                        <Edit3 className="h-3 w-3 mr-1" />
                        Edit
                      </Button>
                    </div>
                    <div className="text-xs text-blue-700">
                      Review the AI-generated response below. You can edit it before sending.
                    </div>
                  </div>
                )}

                {/* CC/BCC Toggle */}
                <div className="mb-2">
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
                  <div className="space-y-2 mb-3">
                    {/* CC Field */}
                    <div>
                      <label className="text-xs font-medium text-gray-700 mb-1 block">CC</label>
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
                        <div className="flex flex-wrap gap-1.5 mt-2">
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
                      <label className="text-xs font-medium text-gray-700 mb-1 block">BCC</label>
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
                        <div className="flex flex-wrap gap-1.5 mt-2">
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

                {/* Rich Text Editor */}
                <div className="space-y-3">
                  <RichTextEditor
                    content={messageToSend}
                    onChange={setMessageToSend}
                    placeholder={
                      selectedLead.needs_approval
                        ? 'Review and edit AI response...'
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

                  {/* Send Buttons */}
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
                          Send Different
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
            </div>
            {/* Lead Details Sidebar (Collapsible) */}
            {!leadSidebarCollapsed && (
              <div className="w-1/3 border-l border-gray-200 bg-gray-50 overflow-y-auto">
                <div className="p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Info className="h-4 w-4" />
                    Lead Details
                  </h3>

                  {/* Contact Information */}
                  <div className="mb-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Contact</h4>
                    <div className="space-y-2 text-sm">
                      <div>
                        <span className="text-gray-600">Name:</span>
                        <p className="font-medium text-gray-900">
                          {selectedLead.lead_name || 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <span className="text-gray-600">Email:</span>
                        <p className="font-medium text-gray-900">{selectedLead.lead_email}</p>
                      </div>
                      {selectedLead.lead_company && (
                        <div>
                          <span className="text-gray-600">Company:</span>
                          <p className="font-medium text-gray-900">{selectedLead.lead_company}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Conversation Metrics */}
                  <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Metrics</h4>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Messages</span>
                        <Badge variant="secondary" className="text-xs">
                          {selectedLead.conversation_thread.length}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Status</span>
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
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Agent</span>
                        <span className="text-xs font-medium text-gray-900">
                          {getAgent(selectedLead.agent_id)?.name || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Lead Category */}
                  <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">
                      Lead Category
                    </h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Interest Level</span>
                        <Badge
                          variant={selectedLead.is_truly_interested ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {selectedLead.is_truly_interested ? 'Interested' : 'Not Interested'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Reply Type</span>
                        <Badge
                          variant={selectedLead.is_automated_original ? 'outline' : 'secondary'}
                          className="text-xs"
                        >
                          {selectedLead.is_automated_original ? 'Automated' : 'Personal'}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">Tracking</span>
                        <Badge
                          variant={selectedLead.is_tracked_original ? 'secondary' : 'outline'}
                          className="text-xs"
                        >
                          {selectedLead.is_tracked_original ? 'Tracked' : 'Untracked'}
                        </Badge>
                      </div>
                      {selectedLead.original_status && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-gray-600">EmailBison Status</span>
                          <span className="text-xs font-medium text-gray-900 capitalize">
                            {selectedLead.original_status.replace('_', ' ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* AI Analysis */}
                  {selectedLead.response_confidence_score !== undefined && (
                    <div className="mb-4 p-3 bg-white rounded-lg border border-gray-200">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">
                        AI Analysis
                      </h4>
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-gray-600">Response Confidence</span>
                            <span className="text-xs font-bold text-gray-900">
                              {selectedLead.response_confidence_score}/10
                            </span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${
                                (selectedLead.response_confidence_score || 0) >= 7
                                  ? 'bg-green-500'
                                  : (selectedLead.response_confidence_score || 0) >= 4
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{
                                width: `${
                                  ((selectedLead.response_confidence_score || 0) / 10) * 100
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                        <div>
                          <span className="text-xs text-gray-600">Confidence Level</span>
                          <Badge
                            variant={
                              (selectedLead.response_confidence_score || 0) >= 7
                                ? 'default'
                                : (selectedLead.response_confidence_score || 0) >= 4
                                ? 'secondary'
                                : 'destructive'
                            }
                            className="text-xs mt-1 block w-fit"
                          >
                            {(selectedLead.response_confidence_score || 0) >= 7
                              ? 'High'
                              : (selectedLead.response_confidence_score || 0) >= 4
                              ? 'Medium'
                              : 'Low'}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Timeline */}
                  <div className="mb-4">
                    <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Timeline</h4>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600">Created:</span>
                        <span className="font-medium text-gray-900">
                          {formatRelativeTime(selectedLead.created_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600">Updated:</span>
                        <span className="font-medium text-gray-900">
                          {formatRelativeTime(selectedLead.updated_at)}
                        </span>
                      </div>
                      {selectedLead.last_response_sent_at && (
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-gray-400" />
                          <span className="text-gray-600">Last Response:</span>
                          <span className="font-medium text-gray-900">
                            {formatRelativeTime(selectedLead.last_response_sent_at)}
                          </span>
                        </div>
                      )}
                      {selectedLead.approved_at && (
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-3 w-3 text-green-500" />
                          <span className="text-gray-600">Approved:</span>
                          <span className="font-medium text-gray-900">
                            {formatRelativeTime(selectedLead.approved_at)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
