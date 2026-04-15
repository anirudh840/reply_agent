'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Check, Globe, TestTube2, X } from 'lucide-react';
import { TIMEZONES, PLATFORM_DISPLAY_NAMES, AI_MODELS } from '@/lib/constants';
import type { AIProvider } from '@/lib/constants';
import type { PlatformType } from '@/lib/platforms/types';

type WizardStep = 1 | 2 | 3 | 4 | 5;

export default function NewAgentPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Mode Selection
  const [mode, setMode] = useState<'fully_automated' | 'human_in_loop'>('human_in_loop');

  // Step 2: Platform & API Keys
  const [platform, setPlatform] = useState<PlatformType>('emailbison');
  const [platformInstanceUrl, setPlatformInstanceUrl] = useState('');
  const [name, setName] = useState('');
  const [emailbisonApiKey, setEmailbisonApiKey] = useState('');
  const [emailbisonWorkspaceId, setEmailbisonWorkspaceId] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [aiProvider, setAiProvider] = useState<AIProvider>('openai');
  const [aiModel, setAiModel] = useState(AI_MODELS.openai[0].id);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');

  // Step 2b: Slack Integration (optional)
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('');
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Step 2c: Booking Integration (optional)
  const [bookingPlatform, setBookingPlatform] = useState<'' | 'cal_com' | 'calendly'>('');
  const [bookingApiKey, setBookingApiKey] = useState('');
  const [bookingEventId, setBookingEventId] = useState('');
  const [bookingLink, setBookingLink] = useState('');
  const [eventTypes, setEventTypes] = useState<Array<{ id: string; name: string; duration: number; booking_url?: string }>>([]);
  const [loadingEventTypes, setLoadingEventTypes] = useState(false);

  // Step 3: Knowledge Base
  const [timezone, setTimezone] = useState('UTC');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [companyInfo, setCompanyInfo] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [valueProps, setValueProps] = useState<string[]>(['']);
  const [customInstructions, setCustomInstructions] = useState('');
  const [objections, setObjections] = useState<Array<{ objection: string; response: string }>>([
    { objection: '', response: '' },
  ]);
  const [caseStudies, setCaseStudies] = useState<Array<{ title: string; description: string; results: string }>>([
    { title: '', description: '', results: '' },
  ]);

  // Step 4: Follow-up Sequence
  const [useDefaultSequence, setUseDefaultSequence] = useState(true);
  const [customSequence, setCustomSequence] = useState([
    { delay_days: 1, type: 'value_driven', instructions: '' },
    { delay_days: 3, type: 'value_driven', instructions: '' },
    { delay_days: 10, type: 'close_up', instructions: '' },
  ]);
  const [confidenceThreshold, setConfidenceThreshold] = useState(6.0);

  // Step 5: Sample Reply Testing
  const [testResults, setTestResults] = useState<any[]>([]);
  const [loadingTests, setLoadingTests] = useState(false);
  const [testResultsLoaded, setTestResultsLoaded] = useState(false);
  const [editedResponses, setEditedResponses] = useState<Record<number, string>>({});
  const [fetchLogs, setFetchLogs] = useState<string[]>([]);

  // Agent creation success
  const [agentCreated, setAgentCreated] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [webhookListening, setWebhookListening] = useState(false);
  const [webhookReceived, setWebhookReceived] = useState<any>(null);
  const [webhookListenStatus, setWebhookListenStatus] = useState<string>('');
  const [webhookElapsed, setWebhookElapsed] = useState(0);

  // Start polling for webhook data when agent is created
  useEffect(() => {
    if (!createdAgentId || webhookReceived) return;

    setWebhookListening(true);
    setWebhookListenStatus('Listening for incoming webhooks...');

    const startTime = Date.now();
    const listeningSince = new Date().toISOString();

    // Poll every 3 seconds for 120 seconds (2 minutes)
    const interval = setInterval(async () => {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      setWebhookElapsed(elapsed);

      if (elapsed > 120) {
        clearInterval(interval);
        setWebhookListening(false);
        setWebhookListenStatus('Listening timed out after 2 minutes. You can restart manually.');
        return;
      }

      try {
        const response = await fetch(
          `/api/agents/${createdAgentId}/webhook-status?since=${encodeURIComponent(listeningSince)}`
        );
        const data = await response.json();

        if (data.success && data.data.has_received_data) {
          clearInterval(interval);
          setWebhookReceived(data.data);
          setWebhookListening(false);
          setWebhookListenStatus('Webhook received!');
        } else {
          setWebhookListenStatus(
            `Listening for incoming webhooks... (${elapsed}s)`
          );
        }
      } catch {
        // Ignore polling errors, keep trying
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [createdAgentId]);

  // Restart webhook listener
  const restartWebhookListener = () => {
    setWebhookReceived(null);
    setWebhookElapsed(0);
    // Changing createdAgentId briefly resets the useEffect
    const id = createdAgentId;
    setCreatedAgentId('');
    setTimeout(() => setCreatedAgentId(id), 100);
  };

  // Website Extraction Function
  const extractFromWebsite = async () => {
    if (!websiteUrl) {
      alert('Please enter a website URL');
      return;
    }

    setExtracting(true);
    try {
      const response = await fetch('/api/extract-website', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: websiteUrl,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setCompanyInfo(data.data.company_info || '');
        setProductDescription(data.data.product_description || '');
        setValueProps(data.data.value_propositions && data.data.value_propositions.length > 0
          ? data.data.value_propositions
          : ['']);
        alert('✓ Information extracted successfully!');
      } else {
        if (data.requiresManualEntry) {
          alert(`⚠️ ${data.error}\n\nYou can still create your agent by entering the information manually below.`);
        } else {
          alert(`Failed to extract: ${data.error}`);
        }
      }
    } catch (error) {
      console.error('Extraction error:', error);
      alert('Failed to extract website information. Please try again.');
    } finally {
      setExtracting(false);
    }
  };

  // Slack Test Function
  const handleTestSlack = async () => {
    if (!slackWebhookUrl) return;
    setTestingSlack(true);
    setSlackTestResult(null);
    try {
      const response = await fetch('/api/integrations/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slack_webhook_url: slackWebhookUrl }),
      });
      const data = await response.json();
      setSlackTestResult(data);
    } catch {
      setSlackTestResult({ success: false, error: 'Network error' });
    } finally {
      setTestingSlack(false);
    }
  };

  // Fetch Booking Event Types
  const handleFetchEventTypes = async () => {
    if (!bookingPlatform || !bookingApiKey) return;
    setLoadingEventTypes(true);
    setEventTypes([]);
    setBookingEventId('');
    setBookingLink('');
    try {
      const response = await fetch('/api/integrations/booking/event-types', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_platform: bookingPlatform, booking_api_key: bookingApiKey }),
      });
      const data = await response.json();
      if (data.success && data.data) {
        setEventTypes(data.data);
        if (data.data.length === 0) {
          alert('No event types found in your account. Please create one first.');
        }
      } else {
        alert(`Failed to fetch event types: ${data.error || 'Unknown error'}`);
      }
    } catch {
      alert('Failed to connect to booking platform. Check your API key.');
    } finally {
      setLoadingEventTypes(false);
    }
  };

  // Fetch Test Results Function
  const fetchTestResults = async () => {
    if (!emailbisonApiKey || !openaiApiKey) {
      alert('Please complete Steps 1 and 2 first');
      return;
    }

    setLoadingTests(true);
    try {
      const response = await fetch('/api/test-responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          platform_instance_url: platform === 'emailbison' && platformInstanceUrl ? platformInstanceUrl : undefined,
          emailbison_api_key: emailbisonApiKey,
          openai_api_key: openaiApiKey,
          knowledge_base: {
            company_info: companyInfo,
            product_description: productDescription,
            value_propositions: valueProps.filter((v) => v.trim()),
            custom_instructions: customInstructions,
          },
        }),
      });

      const data = await response.json();

      // Save logs for debugging
      if (data.logs && data.logs.length > 0) {
        setFetchLogs(data.logs);
        console.log('Fetch Logs:', data.logs.join('\n'));
      }

      if (data.success) {
        setTestResults(data.data || []);
        setTestResultsLoaded(true);

        if (data.data.length === 0) {
          // Show logs in alert if no results
          const logSummary = data.logs ? '\n\nDebug Info:\n' + data.logs.join('\n') : '';
          alert('No interested replies found in your workspace. You can still create the agent.' + logSummary);
        } else {
          alert(`✓ Loaded ${data.data.length} sample replies for testing`);
        }
      } else {
        // Show error with logs
        const logSummary = data.logs ? '\n\nDebug Info:\n' + data.logs.join('\n') : '';
        alert(`Failed to fetch test responses: ${data.error}${logSummary}`);
      }
    } catch (error) {
      console.error('Test error:', error);
      alert('Failed to fetch test responses. Please try again.');
    } finally {
      setLoadingTests(false);
    }
  };

  const handleSubmit = async () => {
    setLoading(true);

    try {
      const agentData = {
        name,
        mode,
        timezone,
        platform,
        platform_instance_url: platform === 'emailbison' && platformInstanceUrl ? platformInstanceUrl : undefined,
        emailbison_workspace_id: platform === 'emailbison' && emailbisonWorkspaceId ? emailbisonWorkspaceId : undefined,
        emailbison_api_key: emailbisonApiKey,
        openai_api_key: openaiApiKey,
        ai_provider: aiProvider,
        ai_model: aiModel,
        anthropic_api_key: aiProvider === 'anthropic' && anthropicApiKey ? anthropicApiKey : undefined,
        knowledge_base: {
          company_info: companyInfo,
          product_description: productDescription,
          value_propositions: valueProps.filter((v) => v.trim()),
          custom_instructions: customInstructions,
        },
        objection_handling: {
          // Use the array format consistently with the configure page so
          // duplicate-keyed entries aren't silently clobbered and partial
          // rows (one field filled, one empty) aren't silently dropped.
          common_objections: objections.filter(
            (o) => (o.objection || '').trim() || (o.response || '').trim()
          ),
        },
        case_studies: caseStudies.filter((cs) => cs.title.trim()),
        followup_sequence: useDefaultSequence
          ? {
              type: 'default',
              steps: [
                { delay_days: 1, type: 'value_driven' },
                { delay_days: 3, type: 'value_driven' },
                { delay_days: 10, type: 'close_up' },
              ],
            }
          : {
              type: 'custom',
              steps: customSequence.map((step) => ({
                delay_days: step.delay_days,
                type: step.type,
                custom_instructions: step.instructions || undefined,
              })),
            },
        confidence_threshold: confidenceThreshold,
        slack_webhook_url: slackWebhookUrl || undefined,
        booking_platform: bookingPlatform || undefined,
        booking_api_key: bookingApiKey || undefined,
        booking_event_id: bookingEventId || undefined,
        booking_link: bookingLink || undefined,
      };

      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(agentData),
      });

      const data = await response.json();

      if (data.success) {
        // Capture webhook URL and agent ID
        setCreatedAgentId(data.data.id);
        setWebhookUrl(data.webhook_url);
        setAgentCreated(true);
        // Don't redirect yet - show webhook setup screen
      } else {
        alert(`Failed to create agent: ${data.error}`);
      }
    } catch (error) {
      console.error('Error creating agent:', error);
      alert('Failed to create agent. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return true;
      case 2:
        return name.trim() && emailbisonApiKey.trim() && openaiApiKey.trim() && (aiProvider !== 'anthropic' || anthropicApiKey.trim());
      case 3:
        return companyInfo.trim() || productDescription.trim();
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="mb-4 text-2xl font-bold">Select Agent Mode</h2>
              <p className="mb-6 text-gray-600">
                Choose how you want the agent to handle responses
              </p>
            </div>

            <div className="grid gap-4">
              <button
                type="button"
                onClick={() => setMode('fully_automated')}
                className={`rounded-lg border-2 p-6 text-left transition-all ${
                  mode === 'fully_automated'
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Fully Automated</h3>
                  {mode === 'fully_automated' && (
                    <Badge variant="default">Selected</Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  High-confidence responses (above threshold) are sent automatically.
                  Low-confidence responses still need approval.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setMode('human_in_loop')}
                className={`rounded-lg border-2 p-6 text-left transition-all ${
                  mode === 'human_in_loop'
                    ? 'border-primary bg-primary/5'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Human in Loop</h3>
                  {mode === 'human_in_loop' && (
                    <Badge variant="default">Selected</Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600">
                  All AI-generated responses require manual approval before sending.
                  Maximum control and oversight.
                </p>
              </button>
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">Platform & API Keys</h2>
              <p className="text-gray-600">
                Choose your outreach platform and connect your accounts
              </p>
            </div>

            {/* Platform Selection */}
            <div>
              <label className="mb-3 block text-sm font-medium">Outreach Platform</label>
              <div className="grid grid-cols-3 gap-3">
                {([
                  { id: 'emailbison' as PlatformType, name: 'EmailBison', desc: 'Custom cold email platform' },
                  { id: 'smartlead' as PlatformType, name: 'Smartlead', desc: 'AI-powered cold outreach' },
                  { id: 'instantly' as PlatformType, name: 'Instantly.ai', desc: 'Cold email at scale' },
                ]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPlatform(p.id)}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      platform === p.id
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <h3 className="text-sm font-semibold">{p.name}</h3>
                      {platform === p.id && (
                        <Badge variant="default" className="text-xs">Selected</Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-600">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Agent Name</label>
              <Input
                required
                placeholder="e.g., Main Campaign Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                {PLATFORM_DISPLAY_NAMES[platform] || 'Platform'} API Key
              </label>
              <Input
                required
                type="password"
                placeholder={`Enter your ${PLATFORM_DISPLAY_NAMES[platform] || 'platform'} API key`}
                value={emailbisonApiKey}
                onChange={(e) => setEmailbisonApiKey(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                {platform === 'emailbison' && 'Get from: mail.revgenlabs.com → Settings → Developer API'}
                {platform === 'smartlead' && 'Get from: Smartlead dashboard → Settings → API'}
                {platform === 'instantly' && 'Get from: Instantly.ai → Settings → Integrations → API'}
              </p>
            </div>

            {/* Instance URL - only for EmailBison */}
            {platform === 'emailbison' && (
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Instance URL (Optional)
                </label>
                <Input
                  placeholder="e.g., mail.revgenlabs.com (leave blank for default)"
                  value={platformInstanceUrl}
                  onChange={(e) => setPlatformInstanceUrl(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Only needed if you use a custom EmailBison instance. Default: mail.revgenlabs.com
                </p>
              </div>
            )}

            {/* Workspace ID - only for EmailBison */}
            {platform === 'emailbison' && (
              <div>
                <label className="mb-2 block text-sm font-medium">
                  Workspace ID
                </label>
                <Input
                  placeholder="e.g., ws_abc123 (from EmailBison workspace settings)"
                  value={emailbisonWorkspaceId}
                  onChange={(e) => setEmailbisonWorkspaceId(e.target.value)}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Found in EmailBison → Settings. Required for multi-workspace isolation to prevent cross-client reply routing.
                </p>
              </div>
            )}

            {/* AI Provider & Model */}
            <div className="border-t pt-4 mt-2">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">AI Provider & Model</h3>
              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium">AI Provider</label>
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={aiProvider}
                    onChange={(e) => {
                      const provider = e.target.value as AIProvider;
                      setAiProvider(provider);
                      setAiModel(AI_MODELS[provider][0].id);
                    }}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic (Claude)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium">Model</label>
                  <select
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    value={aiModel}
                    onChange={(e) => setAiModel(e.target.value)}
                  >
                    {AI_MODELS[aiProvider].map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {aiProvider === 'anthropic' && (
                  <div>
                    <label className="mb-2 block text-sm font-medium">Anthropic API Key</label>
                    <Input
                      required
                      type="password"
                      placeholder="Enter your Anthropic API key (sk-ant-...)"
                      value={anthropicApiKey}
                      onChange={(e) => setAnthropicApiKey(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Get from: console.anthropic.com/settings/keys
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* OpenAI API Key - always required for embeddings */}
            <div>
              <label className="mb-2 block text-sm font-medium">
                OpenAI API Key{aiProvider === 'anthropic' ? ' (required for embeddings)' : ''}
              </label>
              <Input
                required
                type="password"
                placeholder="Enter your OpenAI API key"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                {aiProvider === 'anthropic'
                  ? 'Required for knowledge base embeddings and semantic search (RAG), even when using Anthropic for responses.'
                  : 'Get from: platform.openai.com/api-keys'}
              </p>
            </div>

            {/* Webhook Information */}
            <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4">
              <div className="flex items-start gap-3">
                <Globe className="h-5 w-5 text-blue-600 mt-0.5" />
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">
                    Webhook URL Will Be Auto-Generated
                  </h3>
                  <p className="text-xs text-blue-800 mb-3">
                    After creating this agent, you'll receive a unique webhook URL to configure in your {PLATFORM_DISPLAY_NAMES[platform] || 'platform'} workspace. This ensures replies are routed only to this specific agent.
                  </p>
                  <div className="bg-white rounded border border-blue-200 p-2">
                    <p className="text-xs text-gray-600 mb-1 font-medium">Example webhook URL:</p>
                    <code className="text-xs text-gray-700 font-mono break-all">
                      https://your-domain.vercel.app/api/webhooks/[unique-id]
                    </code>
                  </div>
                  <p className="text-xs text-blue-700 mt-2">
                    You'll be able to copy and test the webhook after completing agent setup
                  </p>
                </div>
              </div>
            </div>

            {/* Slack Integration (Optional) */}
            <details className="rounded-md border">
              <summary className="cursor-pointer p-4 font-medium">
                Slack Notifications (Optional)
              </summary>
              <div className="border-t p-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Get notified in Slack when interested leads reply to your campaigns.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium">Slack Incoming Webhook URL</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="https://hooks.slack.com/services/T.../B.../..."
                      value={slackWebhookUrl}
                      onChange={(e) => {
                        setSlackWebhookUrl(e.target.value);
                        setSlackTestResult(null);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleTestSlack}
                      disabled={testingSlack || !slackWebhookUrl}
                      className="min-w-[100px]"
                    >
                      {testingSlack ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'Test'
                      )}
                    </Button>
                  </div>
                  {slackTestResult && (
                    <div className={`mt-2 flex items-center gap-2 text-sm ${slackTestResult.success ? 'text-green-600' : 'text-red-600'}`}>
                      {slackTestResult.success ? (
                        <><Check className="h-4 w-4" /> Connected! Check your Slack channel.</>
                      ) : (
                        <><X className="h-4 w-4" /> {slackTestResult.error || 'Connection failed'}</>
                      )}
                    </div>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    Create an Incoming Webhook in your Slack workspace settings and paste the URL here.
                  </p>
                </div>
              </div>
            </details>

            {/* Booking Integration (Optional) */}
            <details className="rounded-md border">
              <summary className="cursor-pointer p-4 font-medium">
                Calendar Booking (Optional)
              </summary>
              <div className="border-t p-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Let the AI check your calendar availability and book meetings with interested leads.
                </p>

                <div>
                  <label className="mb-2 block text-sm font-medium">Booking Platform</label>
                  <select
                    value={bookingPlatform}
                    onChange={(e) => {
                      setBookingPlatform(e.target.value as '' | 'cal_com' | 'calendly');
                      setEventTypes([]);
                      setBookingEventId('');
                      setBookingLink('');
                    }}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value="">None</option>
                    <option value="cal_com">Cal.com</option>
                    <option value="calendly">Calendly</option>
                  </select>
                </div>

                {bookingPlatform && (
                  <>
                    <div>
                      <label className="mb-2 block text-sm font-medium">
                        {bookingPlatform === 'cal_com' ? 'Cal.com' : 'Calendly'} API Key
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          placeholder={`Enter your ${bookingPlatform === 'cal_com' ? 'Cal.com' : 'Calendly'} API key`}
                          value={bookingApiKey}
                          onChange={(e) => setBookingApiKey(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={handleFetchEventTypes}
                          disabled={loadingEventTypes || !bookingApiKey}
                          className="min-w-[140px]"
                        >
                          {loadingEventTypes ? (
                            <><Loader2 className="h-4 w-4 animate-spin" /> Loading...</>
                          ) : (
                            'Fetch Events'
                          )}
                        </Button>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {bookingPlatform === 'cal_com'
                          ? 'Get from: cal.com → Settings → Developer → API Keys'
                          : 'Get from: calendly.com → Integrations → API & Webhooks → Personal Access Tokens'}
                      </p>
                    </div>

                    {eventTypes.length > 0 && (
                      <div>
                        <label className="mb-2 block text-sm font-medium">Select Event Type</label>
                        <select
                          value={bookingEventId}
                          onChange={(e) => {
                            setBookingEventId(e.target.value);
                            const selected = eventTypes.find((et) => et.id === e.target.value);
                            if (selected?.booking_url) {
                              setBookingLink(selected.booking_url);
                            }
                          }}
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Choose an event...</option>
                          {eventTypes.map((et) => (
                            <option key={et.id} value={et.id}>
                              {et.name} ({et.duration} min)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {bookingPlatform === 'calendly' && bookingEventId && (
                      <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                        <p className="text-xs text-blue-800">
                          Calendly Scheduling API requires a paid plan. The AI will check availability and book meetings automatically.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </details>
          </div>
        );

      case 3:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">Knowledge Base</h2>
              <p className="text-gray-600">
                Provide context for AI to generate accurate responses
              </p>
            </div>

            {/* Website Extraction Feature */}
            <div className="rounded-lg border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 p-6">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-blue-900">Quick Setup: Extract from Website</h3>
              </div>
              <p className="mb-4 text-sm text-blue-700">
                Automatically extract company information from your website using AI
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="https://yourcompany.com"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  className="bg-white"
                />
                <Button
                  type="button"
                  onClick={extractFromWebsite}
                  disabled={extracting || !websiteUrl}
                  className="min-w-[140px]"
                >
                  {extracting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Globe className="h-4 w-4" />
                      Extract Info
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Company Info</label>
              <textarea
                rows={3}
                placeholder="Brief description of your company..."
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Product/Service Description
              </label>
              <textarea
                rows={3}
                placeholder="What product or service are you offering..."
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Value Propositions
              </label>
              {valueProps.map((prop, idx) => (
                <div key={idx} className="mb-2 flex gap-2">
                  <Input
                    placeholder={`Value proposition ${idx + 1}`}
                    value={prop}
                    onChange={(e) => {
                      const newProps = [...valueProps];
                      newProps[idx] = e.target.value;
                      setValueProps(newProps);
                    }}
                  />
                  {valueProps.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      onClick={() => {
                        setValueProps(valueProps.filter((_, i) => i !== idx));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setValueProps([...valueProps, ''])}
              >
                <Plus className="h-4 w-4" />
                Add Value Proposition
              </Button>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Custom Instructions (Optional)
              </label>
              <textarea
                rows={3}
                placeholder="Any specific instructions for the AI..."
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>

            <details className="rounded-md border">
              <summary className="cursor-pointer p-4 font-medium">
                Objection Handling (Optional)
              </summary>
              <div className="border-t p-4">
                {objections.map((obj, idx) => (
                  <div key={idx} className="mb-4 rounded-md border p-3">
                    <Input
                      placeholder="Common objection"
                      value={obj.objection}
                      onChange={(e) => {
                        const newObjs = [...objections];
                        newObjs[idx].objection = e.target.value;
                        setObjections(newObjs);
                      }}
                      className="mb-2"
                    />
                    <textarea
                      rows={2}
                      placeholder="How to handle this objection..."
                      value={obj.response}
                      onChange={(e) => {
                        const newObjs = [...objections];
                        newObjs[idx].response = e.target.value;
                        setObjections(newObjs);
                      }}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setObjections([...objections, { objection: '', response: '' }])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add Objection
                </Button>
              </div>
            </details>

            <details className="rounded-md border">
              <summary className="cursor-pointer p-4 font-medium">
                Case Studies (Optional)
              </summary>
              <div className="border-t p-4">
                {caseStudies.map((cs, idx) => (
                  <div key={idx} className="mb-4 rounded-md border p-3">
                    <Input
                      placeholder="Case study title"
                      value={cs.title}
                      onChange={(e) => {
                        const newCS = [...caseStudies];
                        newCS[idx].title = e.target.value;
                        setCaseStudies(newCS);
                      }}
                      className="mb-2"
                    />
                    <textarea
                      rows={2}
                      placeholder="Description"
                      value={cs.description}
                      onChange={(e) => {
                        const newCS = [...caseStudies];
                        newCS[idx].description = e.target.value;
                        setCaseStudies(newCS);
                      }}
                      className="mb-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <Input
                      placeholder="Results achieved"
                      value={cs.results}
                      onChange={(e) => {
                        const newCS = [...caseStudies];
                        newCS[idx].results = e.target.value;
                        setCaseStudies(newCS);
                      }}
                    />
                  </div>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setCaseStudies([
                      ...caseStudies,
                      { title: '', description: '', results: '' },
                    ])
                  }
                >
                  <Plus className="h-4 w-4" />
                  Add Case Study
                </Button>
              </div>
            </details>
          </div>
        );

      case 4:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">Follow-up Sequence</h2>
              <p className="text-gray-600">
                Configure how follow-ups are sent to leads
              </p>
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

            <div>
              <label className="mb-2 block text-sm font-medium">
                Follow-up Sequence Type
              </label>
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setUseDefaultSequence(true)}
                  className={`w-full rounded-lg border-2 p-4 text-left ${
                    useDefaultSequence
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold">Default Sequence</span>
                    {useDefaultSequence && <Check className="h-4 w-4" />}
                  </div>
                  <p className="text-sm text-gray-600">
                    Day 1: Value follow-up • Day 4: Second follow-up • Day 14:
                    Close-up
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setUseDefaultSequence(false)}
                  className={`w-full rounded-lg border-2 p-4 text-left ${
                    !useDefaultSequence
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-semibold">Custom Sequence</span>
                    {!useDefaultSequence && <Check className="h-4 w-4" />}
                  </div>
                  <p className="text-sm text-gray-600">
                    Define your own delays and instructions
                  </p>
                </button>
              </div>
            </div>

            {!useDefaultSequence && (
              <div className="space-y-4">
                {customSequence.map((step, idx) => (
                  <div key={idx} className="rounded-md border p-4">
                    <h4 className="mb-3 font-semibold">Follow-up {idx + 1}</h4>
                    <div className="mb-3">
                      <label className="mb-1 block text-sm">
                        Delay (days after previous message)
                      </label>
                      <Input
                        type="number"
                        min="1"
                        value={step.delay_days}
                        onChange={(e) => {
                          const newSeq = [...customSequence];
                          newSeq[idx].delay_days = parseInt(e.target.value);
                          setCustomSequence(newSeq);
                        }}
                      />
                    </div>
                    <div className="mb-3">
                      <label className="mb-1 block text-sm">Type</label>
                      <select
                        value={step.type}
                        onChange={(e) => {
                          const newSeq = [...customSequence];
                          newSeq[idx].type = e.target.value as any;
                          setCustomSequence(newSeq);
                        }}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      >
                        <option value="value_driven">Value Driven</option>
                        <option value="close_up">Close Up</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm">
                        Custom Instructions (Optional)
                      </label>
                      <textarea
                        rows={2}
                        placeholder="Specific instructions for this follow-up..."
                        value={step.instructions}
                        onChange={(e) => {
                          const newSeq = [...customSequence];
                          newSeq[idx].instructions = e.target.value;
                          setCustomSequence(newSeq);
                        }}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );

      case 5:
        return (
          <div className="space-y-6">
            <div>
              <h2 className="mb-2 text-2xl font-bold">Test with Sample Replies</h2>
              <p className="text-gray-600">
                Test your agent with real interested replies from your platform
              </p>
            </div>

            {!testResultsLoaded ? (
              <Card className="overflow-hidden">
                <CardHeader className="bg-gradient-to-r from-purple-50 to-blue-50">
                  <div className="flex items-center gap-3">
                    <TestTube2 className="h-6 w-6 text-purple-600" />
                    <div>
                      <CardTitle>Ready to Test</CardTitle>
                      <CardDescription>
                        Fetch sample replies and see how your agent responds
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <p className="mb-4 text-sm text-gray-600">
                    Click below to fetch up to 5 sample interested replies from your
                    {PLATFORM_DISPLAY_NAMES[platform] || 'platform'} workspace. You'll be able to review and edit the
                    AI-generated responses before creating the agent.
                  </p>
                  <Button
                    onClick={fetchTestResults}
                    disabled={loadingTests}
                    size="lg"
                    className="w-full"
                  >
                    {loadingTests ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Fetching Sample Replies...
                      </>
                    ) : (
                      <>
                        <TestTube2 className="h-4 w-4" />
                        Fetch Sample Replies & Test
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            ) : testResults.length === 0 ? (
              <Card className="p-8 text-center">
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                  <TestTube2 className="h-8 w-8 text-gray-400" />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-gray-900">
                  No Interested Replies Found
                </h3>
                <p className="text-sm text-gray-600">
                  Your workspace doesn't have any interested replies yet.
                  You can still create the agent and test it later when replies come in.
                </p>
              </Card>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-gradient-to-r from-green-50 to-emerald-50 p-4">
                  <p className="text-sm font-medium text-green-900">
                    ✓ Found {testResults.length} sample {testResults.length === 1 ? 'reply' : 'replies'}
                  </p>
                  <p className="text-xs text-green-700">
                    Review and edit the AI-generated responses below. Your edits help train the agent.
                  </p>
                </div>

                {testResults.map((result, idx) => (
                  <Card key={idx} className="overflow-hidden">
                    <CardHeader className="bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-base">
                            From: {result.reply.from_name || result.reply.from_email}
                          </CardTitle>
                          {result.reply.subject && (
                            <p className="mt-1 text-sm text-gray-600">
                              Subject: {result.reply.subject}
                            </p>
                          )}
                        </div>
                        <Badge
                          variant={
                            result.confidence_score >= 8
                              ? 'default'
                              : result.confidence_score >= 6
                              ? 'secondary'
                              : 'destructive'
                          }
                        >
                          Confidence: {result.confidence_score}/10
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4 pt-4">
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-700">
                          Their Message:
                        </h4>
                        <div className="rounded-md bg-gray-50 p-3">
                          <p className="text-sm text-gray-900">{result.reply.body}</p>
                        </div>
                      </div>

                      {result.generated_response ? (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <h4 className="text-sm font-medium text-gray-700">
                              AI Generated Response:
                            </h4>
                            {editedResponses[idx] &&
                              editedResponses[idx] !== result.generated_response && (
                                <Badge variant="outline" className="text-blue-600">
                                  ✏️ Edited
                                </Badge>
                              )}
                          </div>
                          <textarea
                            value={
                              editedResponses[idx] !== undefined
                                ? editedResponses[idx]
                                : result.generated_response
                            }
                            onChange={(e) => {
                              const newEdited = { ...editedResponses };
                              newEdited[idx] = e.target.value;
                              setEditedResponses(newEdited);
                            }}
                            rows={6}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                            placeholder="Edit the response if needed..."
                          />
                          {result.reasoning && (
                            <p className="mt-2 text-xs text-gray-500">
                              💡 <strong>AI Reasoning:</strong> {result.reasoning}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="rounded-md bg-red-50 p-3">
                          <p className="text-sm text-red-800">
                            ⚠️ Failed to generate response: {result.error}
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}

                <div className="rounded-lg bg-blue-50 p-4">
                  <p className="text-sm font-medium text-blue-900">
                    📊 Testing Summary
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-blue-700">
                    <li>• {testResults.length} sample responses tested</li>
                    {Object.keys(editedResponses).length > 0 && (
                      <li>• {Object.keys(editedResponses).length} responses edited by you</li>
                    )}
                    <li>• Your edits will help the agent learn your communication style</li>
                  </ul>
                </div>
              </div>
            )}

            {testResultsLoaded && (
              <div className="rounded-lg border-2 border-green-200 bg-green-50 p-4">
                <div className="flex items-center gap-2">
                  <Check className="h-5 w-5 text-green-600" />
                  <p className="font-medium text-green-900">
                    Testing Complete - Ready to Create Agent
                  </p>
                </div>
                <p className="mt-1 text-sm text-green-700">
                  {testResults.length > 0
                    ? "You've reviewed the sample responses. Proceed to create your agent."
                    : "No test data available, but you can create the agent and test it later."}
                </p>
              </div>
            )}
          </div>
        );
    }
  };

  const steps = [
    { number: 1, name: 'Mode' },
    { number: 2, name: 'Platform' },
    { number: 3, name: 'Knowledge' },
    { number: 4, name: 'Follow-ups' },
    { number: 5, name: 'Test' },
  ];

  // Show success screen if agent is created
  if (agentCreated) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="mx-auto max-w-3xl">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <CardTitle>Agent Created Successfully!</CardTitle>
                  <CardDescription>
                    Configure your webhook to start receiving replies
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Webhook URL Section */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Your Webhook URL
                </h3>
                <div className="flex gap-2">
                  <Input
                    value={webhookUrl}
                    readOnly
                    className="font-mono text-sm"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(webhookUrl);
                      alert('✓ Webhook URL copied to clipboard!');
                    }}
                  >
                    Copy
                  </Button>
                </div>
                <p className="mt-2 text-xs text-gray-600">
                  Add this webhook URL to your {PLATFORM_DISPLAY_NAMES[platform] || 'platform'} workspace to receive reply notifications
                </p>
              </div>

              {/* Webhook Listener Section */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TestTube2 className="h-4 w-4" />
                  Webhook Listener
                </h3>

                {/* Listening state - pulsing indicator */}
                {webhookListening && !webhookReceived && (
                  <div className="p-4 rounded-lg border border-blue-200 bg-blue-50">
                    <div className="flex items-center gap-3">
                      <div className="relative flex h-3 w-3">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-blue-500"></span>
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-sm text-blue-900">
                          Listening for incoming webhooks...
                        </p>
                        <p className="text-xs text-blue-700 mt-1">
                          {webhookListenStatus}
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          Send a test webhook from {PLATFORM_DISPLAY_NAMES[platform] || 'your platform'} to this URL. Listening for up to 2 minutes.
                        </p>
                        {/* Timer bar */}
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-blue-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
                              style={{ width: `${Math.min((webhookElapsed / 120) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-blue-500 font-mono w-12 text-right">
                            {webhookElapsed}s
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Timed out state */}
                {!webhookListening && !webhookReceived && webhookElapsed > 0 && (
                  <div className="p-4 rounded-lg border border-amber-200 bg-amber-50">
                    <div className="flex items-start gap-2">
                      <X className="h-5 w-5 text-amber-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-sm text-amber-900">
                          No webhook received yet
                        </p>
                        <p className="text-xs text-amber-700 mt-1">
                          No incoming webhook was detected in 2 minutes. Make sure you've added the webhook URL in {PLATFORM_DISPLAY_NAMES[platform] || 'your platform'}.
                        </p>
                        <Button
                          onClick={restartWebhookListener}
                          variant="outline"
                          size="sm"
                          className="mt-2"
                        >
                          <TestTube2 className="h-3 w-3 mr-1" />
                          Restart Listener
                        </Button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Success state - webhook received */}
                {webhookReceived && (
                  <div className="p-4 rounded-lg border border-green-200 bg-green-50">
                    <div className="flex items-start gap-2">
                      <Check className="h-5 w-5 text-green-600 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-medium text-sm text-green-900">
                          Webhook received successfully!
                        </p>
                        <p className="text-xs text-green-700 mt-1">
                          Total replies received: {webhookReceived.total_replies}
                        </p>
                        {webhookReceived.latest_reply && (
                          <div className="mt-2 p-2 bg-green-100 rounded text-xs text-green-800">
                            <p><strong>Latest:</strong> {webhookReceived.latest_reply.lead_email}</p>
                            <p><strong>Subject:</strong> {webhookReceived.latest_reply.subject}</p>
                            <p><strong>Status:</strong> {webhookReceived.latest_reply.status}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">
                  Setup Steps:
                </h4>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Copy the webhook URL above</li>
                  <li>Go to your {PLATFORM_DISPLAY_NAMES[platform] || 'platform'} workspace settings</li>
                  <li>Add this URL as a webhook endpoint</li>
                  <li>Configure it to trigger on "reply.received" events</li>
                  <li>The listener above will automatically detect incoming webhooks</li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    const urls: Record<string, string> = {
                      emailbison: platformInstanceUrl ? `https://${platformInstanceUrl}` : 'https://mail.revgenlabs.com',
                      smartlead: 'https://app.smartlead.ai',
                      instantly: 'https://app.instantly.ai',
                    };
                    window.open(urls[platform] || '#', '_blank');
                  }}
                >
                  Open {PLATFORM_DISPLAY_NAMES[platform] || 'Platform'}
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => router.push('/agents')}
                >
                  Go to Agents Dashboard
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Back to Agents
        </Button>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-between">
          {steps.map((step, idx) => (
            <div key={step.number} className="flex items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors ${
                  currentStep >= step.number
                    ? 'border-primary bg-primary text-white'
                    : 'border-gray-300 bg-white text-gray-400'
                }`}
              >
                {currentStep > step.number ? (
                  <Check className="h-5 w-5" />
                ) : (
                  step.number
                )}
              </div>
              <span
                className={`ml-2 hidden text-sm font-medium sm:inline ${
                  currentStep >= step.number ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {step.name}
              </span>
              {idx < steps.length - 1 && (
                <div
                  className={`mx-2 h-0.5 w-12 transition-colors sm:mx-4 ${
                    currentStep > step.number ? 'bg-primary' : 'bg-gray-300'
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        <Card>
          <CardContent className="p-8">{renderStep()}</CardContent>
        </Card>

        {/* Navigation Buttons */}
        <div className="mt-6 flex justify-between">
          <Button
            variant="outline"
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1) as WizardStep)}
            disabled={currentStep === 1}
          >
            <ArrowLeft className="h-4 w-4" />
            Previous
          </Button>

          {currentStep < 5 ? (
            <Button
              onClick={() => setCurrentStep((prev) => Math.min(5, prev + 1) as WizardStep)}
              disabled={!canProceed()}
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={loading || !canProceed()}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create Agent
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
