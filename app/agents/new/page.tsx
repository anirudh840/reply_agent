'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Check, Globe, TestTube2, X } from 'lucide-react';
import { TIMEZONES } from '@/lib/constants';

type WizardStep = 1 | 2 | 3 | 4 | 5;

export default function NewAgentPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);
  const [loading, setLoading] = useState(false);

  // Step 1: Mode Selection
  const [mode, setMode] = useState<'fully_automated' | 'human_in_loop'>('human_in_loop');

  // Step 2: API Keys
  const [name, setName] = useState('');
  const [emailbisonApiKey, setEmailbisonApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');

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

  // Agent creation success
  const [agentCreated, setAgentCreated] = useState(false);
  const [createdAgentId, setCreatedAgentId] = useState<string>('');
  const [webhookUrl, setWebhookUrl] = useState<string>('');
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [webhookTestResult, setWebhookTestResult] = useState<any>(null);

  // Test Webhook Function
  const testWebhook = async () => {
    if (!createdAgentId) return;

    setTestingWebhook(true);
    setWebhookTestResult(null);

    try {
      const response = await fetch(`/api/agents/${createdAgentId}/test-webhook`, {
        method: 'POST',
      });

      const data = await response.json();
      setWebhookTestResult(data);
    } catch (error) {
      console.error('Error testing webhook:', error);
      setWebhookTestResult({
        success: false,
        error: 'Failed to test webhook',
      });
    } finally {
      setTestingWebhook(false);
    }
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

      if (data.success) {
        setTestResults(data.data || []);
        setTestResultsLoaded(true);

        if (data.data.length === 0) {
          alert('ℹ️ No interested replies found in your EmailBison workspace. You can still create the agent.');
        } else {
          alert(`✓ Loaded ${data.data.length} sample replies for testing`);
        }
      } else {
        alert(`Failed to fetch test responses: ${data.error}`);
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
        emailbison_api_key: emailbisonApiKey,
        openai_api_key: openaiApiKey,
        knowledge_base: {
          company_info: companyInfo,
          product_description: productDescription,
          value_propositions: valueProps.filter((v) => v.trim()),
          custom_instructions: customInstructions,
        },
        objection_handling: objections.reduce((acc, obj) => {
          if (obj.objection.trim()) {
            acc[obj.objection] = obj.response;
          }
          return acc;
        }, {} as Record<string, string>),
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
        return name.trim() && emailbisonApiKey.trim() && openaiApiKey.trim();
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
              <h2 className="mb-2 text-2xl font-bold">API Keys & Configuration</h2>
              <p className="text-gray-600">
                Connect your EmailBison and OpenAI accounts
              </p>
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
                EmailBison API Key
              </label>
              <Input
                required
                type="password"
                placeholder="Enter your EmailBison API key"
                value={emailbisonApiKey}
                onChange={(e) => setEmailbisonApiKey(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Get from: mail.revgenlabs.com → Settings → Developer API
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                OpenAI API Key
              </label>
              <Input
                required
                type="password"
                placeholder="Enter your OpenAI API key"
                value={openaiApiKey}
                onChange={(e) => setOpenaiApiKey(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">
                Get from: platform.openai.com/api-keys
              </p>
            </div>
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
                Test your agent with real interested replies from EmailBison
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
                    EmailBison workspace. You'll be able to review and edit the
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
                  Your EmailBison workspace doesn't have any interested replies yet.
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
    { number: 2, name: 'API Keys' },
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
                  Add this webhook URL to your EmailBison workspace to receive reply notifications
                </p>
              </div>

              {/* Test Webhook Section */}
              <div>
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <TestTube2 className="h-4 w-4" />
                  Test Your Webhook
                </h3>
                <Button
                  onClick={testWebhook}
                  disabled={testingWebhook}
                  variant="outline"
                  className="w-full"
                >
                  {testingWebhook ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <TestTube2 className="h-4 w-4 mr-2" />
                      Test Webhook
                    </>
                  )}
                </Button>

                {webhookTestResult && (
                  <div
                    className={`mt-3 p-4 rounded-lg border ${
                      webhookTestResult.success
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {webhookTestResult.success ? (
                        <Check className="h-5 w-5 text-green-600 mt-0.5" />
                      ) : (
                        <X className="h-5 w-5 text-red-600 mt-0.5" />
                      )}
                      <div className="flex-1">
                        <p className={`font-medium text-sm ${
                          webhookTestResult.success ? 'text-green-900' : 'text-red-900'
                        }`}>
                          {webhookTestResult.success
                            ? 'Webhook is working correctly!'
                            : 'Webhook test failed'}
                        </p>
                        <p className={`text-xs mt-1 ${
                          webhookTestResult.success ? 'text-green-700' : 'text-red-700'
                        }`}>
                          {webhookTestResult.message || webhookTestResult.error}
                        </p>
                        {webhookTestResult.status_code && (
                          <p className="text-xs mt-1 text-gray-600">
                            Status Code: {webhookTestResult.status_code}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Instructions */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h4 className="font-semibold text-sm text-blue-900 mb-2">
                  Next Steps:
                </h4>
                <ol className="text-sm text-blue-800 space-y-1 list-decimal list-inside">
                  <li>Copy the webhook URL above</li>
                  <li>Go to your EmailBison workspace settings</li>
                  <li>Add this URL as a webhook endpoint</li>
                  <li>Configure it to trigger on "reply.received" events</li>
                  <li>Test the webhook using the button above</li>
                </ol>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.open('https://mail.revgenlabs.com', '_blank')}
                >
                  Open EmailBison
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
