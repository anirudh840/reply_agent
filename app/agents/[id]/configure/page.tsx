'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Save, Loader2, Plus, Trash2, Globe, AlertCircle } from 'lucide-react';
import { TIMEZONES, PLATFORM_DISPLAY_NAMES } from '@/lib/constants';
import type { Agent } from '@/lib/types';

export default function ConfigureAgentPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agent, setAgent] = useState<Agent | null>(null);

  // Form state - Basic
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'fully_automated' | 'human_in_loop'>('human_in_loop');
  const [timezone, setTimezone] = useState('UTC');
  const [confidenceThreshold, setConfidenceThreshold] = useState(6.0);

  // Knowledge Base
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [companyInfo, setCompanyInfo] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [valueProps, setValueProps] = useState<string[]>(['']);
  const [customInstructions, setCustomInstructions] = useState('');

  // Objection Handling
  const [objections, setObjections] = useState<Array<{ objection: string; response: string }>>([
    { objection: '', response: '' },
  ]);

  // Case Studies
  const [caseStudies, setCaseStudies] = useState<
    Array<{ title: string; description: string; results: string }>
  >([{ title: '', description: '', results: '' }]);

  // Follow-up Sequence
  const [useDefaultSequence, setUseDefaultSequence] = useState(true);
  const [customSequence, setCustomSequence] = useState([
    { delay_days: 1, type: 'value_driven', instructions: '' },
    { delay_days: 3, type: 'value_driven', instructions: '' },
    { delay_days: 10, type: 'close_up', instructions: '' },
  ]);

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
        const agentData = data.data;
        setAgent(agentData);

        // Populate form fields
        setName(agentData.name);
        setMode(agentData.mode);
        setTimezone(agentData.timezone);
        setConfidenceThreshold(agentData.confidence_threshold);

        // Knowledge Base
        const kb = agentData.knowledge_base || {};
        setCompanyInfo(kb.company_info || '');
        setProductDescription(kb.product_description || '');
        setValueProps(kb.value_propositions && kb.value_propositions.length > 0 ? kb.value_propositions : ['']);
        setCustomInstructions(kb.custom_instructions || '');

        // Objection Handling
        const objHandling = agentData.objection_handling || {};
        if (objHandling.common_objections && objHandling.common_objections.length > 0) {
          setObjections(objHandling.common_objections);
        }

        // Case Studies
        const studies = agentData.case_studies || [];
        if (studies.length > 0) {
          setCaseStudies(studies);
        }

        // Follow-up Sequence
        const followup = agentData.followup_sequence || {};
        if (followup.type === 'custom' && followup.steps) {
          setUseDefaultSequence(false);
          setCustomSequence(followup.steps);
        }
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
        body: JSON.stringify({ url: websiteUrl }),
      });

      const data = await response.json();

      if (data.success) {
        setCompanyInfo(data.data.company_info || '');
        setProductDescription(data.data.product_description || '');
        setValueProps(
          data.data.value_propositions && data.data.value_propositions.length > 0
            ? data.data.value_propositions
            : ['']
        );
        alert('✓ Information extracted successfully!');
      } else {
        if (data.requiresManualEntry) {
          alert(
            `⚠️ ${data.error}\n\nYou can still update your agent by entering the information manually below.`
          );
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

  const handleSave = async () => {
    if (!name.trim()) {
      alert('Please enter an agent name');
      return;
    }

    setSaving(true);
    try {
      const updates = {
        name,
        mode,
        timezone,
        confidence_threshold: confidenceThreshold,
        knowledge_base: {
          company_info: companyInfo,
          product_description: productDescription,
          value_propositions: valueProps.filter((v) => v.trim()),
          custom_instructions: customInstructions,
        },
        objection_handling: {
          common_objections: objections.filter((o) => o.objection.trim()),
        },
        case_studies: caseStudies.filter((c) => c.title.trim()),
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
              steps: customSequence,
            },
      };

      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });

      const data = await response.json();

      if (data.success) {
        alert('✓ Agent updated successfully!');
        router.push('/agents');
      } else {
        alert(`Failed to update agent: ${data.error}`);
      }
    } catch (error) {
      console.error('Save error:', error);
      alert('Failed to update agent. Please try again.');
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
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6">
          <Button variant="ghost" onClick={() => router.push('/agents')} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Agents
          </Button>
          <h1 className="text-3xl font-bold">Configure Agent</h1>
          <p className="text-gray-600">Edit {agent.name} settings and knowledge base</p>
        </div>

        {/* Alert about API keys */}
        <Card className="mb-6 border-blue-200 bg-blue-50">
          <CardContent className="pt-6">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-blue-900">
                  <strong>Note:</strong> Platform, API keys, and OpenAI key cannot be edited for
                  security reasons. If you need to change them, please create a new agent.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Basic Settings */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Basic Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Platform Badge (read-only) */}
            <div>
              <label className="mb-2 block text-sm font-medium">Platform</label>
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-sm px-3 py-1">
                {PLATFORM_DISPLAY_NAMES[agent.platform || 'emailbison'] || 'EmailBison'}
              </Badge>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Agent Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Sales Outreach Agent" />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setMode('human_in_loop')}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${
                    mode === 'human_in_loop'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <h3 className="mb-1 font-semibold">Human in Loop</h3>
                  <p className="text-sm text-gray-600">Review and approve AI responses before sending</p>
                </button>
                <button
                  onClick={() => setMode('fully_automated')}
                  className={`rounded-lg border-2 p-4 text-left transition-all ${
                    mode === 'fully_automated'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <h3 className="mb-1 font-semibold">Fully Automated</h3>
                  <p className="text-sm text-gray-600">AI sends responses automatically without approval</p>
                </button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Confidence Threshold ({confidenceThreshold}/10)
              </label>
              <input
                type="range"
                min="1"
                max="10"
                step="0.5"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(parseFloat(e.target.value))}
                className="w-full"
              />
              <p className="mt-1 text-xs text-gray-500">
                Responses below this confidence score will require manual approval
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Knowledge Base */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Knowledge Base</CardTitle>
            <CardDescription>Information about your company, product, and value propositions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Website Extraction */}
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Globe className="h-5 w-5 text-blue-600" />
                <h3 className="font-semibold text-blue-900">Extract from Website</h3>
              </div>
              <div className="flex gap-2">
                <Input
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://yourcompany.com"
                  className="bg-white"
                />
                <Button onClick={extractFromWebsite} disabled={extracting || !websiteUrl}>
                  {extracting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Extracting...
                    </>
                  ) : (
                    'Extract Info'
                  )}
                </Button>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Company Info</label>
              <textarea
                value={companyInfo}
                onChange={(e) => setCompanyInfo(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                placeholder="Brief description of your company and mission..."
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Product/Service Description</label>
              <textarea
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                placeholder="What products or services do you offer..."
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Value Propositions</label>
              {valueProps.map((prop, index) => (
                <div key={index} className="mb-2 flex gap-2">
                  <Input
                    value={prop}
                    onChange={(e) => {
                      const newProps = [...valueProps];
                      newProps[index] = e.target.value;
                      setValueProps(newProps);
                    }}
                    placeholder={`Value proposition ${index + 1}`}
                  />
                  {valueProps.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setValueProps(valueProps.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setValueProps([...valueProps, ''])}
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Value Prop
              </Button>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Custom Instructions (Optional)</label>
              <textarea
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-gray-300 px-3 py-2"
                placeholder="Additional context or instructions for the AI..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Objection Handling */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Objection Handling (Optional)</CardTitle>
            <CardDescription>Common objections and how to address them</CardDescription>
          </CardHeader>
          <CardContent>
            {objections.map((obj, index) => (
              <div key={index} className="mb-4 rounded-lg border border-gray-200 p-4">
                <div className="mb-2">
                  <label className="mb-1 block text-sm font-medium">Objection</label>
                  <Input
                    value={obj.objection}
                    onChange={(e) => {
                      const newObjs = [...objections];
                      newObjs[index].objection = e.target.value;
                      setObjections(newObjs);
                    }}
                    placeholder="e.g., Too expensive"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Response</label>
                  <textarea
                    value={obj.response}
                    onChange={(e) => {
                      const newObjs = [...objections];
                      newObjs[index].response = e.target.value;
                      setObjections(newObjs);
                    }}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="How to address this objection..."
                  />
                </div>
                {objections.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setObjections(objections.filter((_, i) => i !== index))}
                    className="mt-2"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() => setObjections([...objections, { objection: '', response: '' }])}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Objection
            </Button>
          </CardContent>
        </Card>

        {/* Case Studies */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Case Studies (Optional)</CardTitle>
            <CardDescription>Success stories and examples</CardDescription>
          </CardHeader>
          <CardContent>
            {caseStudies.map((study, index) => (
              <div key={index} className="mb-4 rounded-lg border border-gray-200 p-4">
                <div className="mb-2">
                  <label className="mb-1 block text-sm font-medium">Title</label>
                  <Input
                    value={study.title}
                    onChange={(e) => {
                      const newStudies = [...caseStudies];
                      newStudies[index].title = e.target.value;
                      setCaseStudies(newStudies);
                    }}
                    placeholder="e.g., Increased revenue by 300%"
                  />
                </div>
                <div className="mb-2">
                  <label className="mb-1 block text-sm font-medium">Description</label>
                  <textarea
                    value={study.description}
                    onChange={(e) => {
                      const newStudies = [...caseStudies];
                      newStudies[index].description = e.target.value;
                      setCaseStudies(newStudies);
                    }}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="Context and background..."
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Results</label>
                  <textarea
                    value={study.results}
                    onChange={(e) => {
                      const newStudies = [...caseStudies];
                      newStudies[index].results = e.target.value;
                      setCaseStudies(newStudies);
                    }}
                    rows={2}
                    className="w-full rounded-md border border-gray-300 px-3 py-2"
                    placeholder="Measurable outcomes..."
                  />
                </div>
                {caseStudies.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCaseStudies(caseStudies.filter((_, i) => i !== index))}
                    className="mt-2"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              onClick={() =>
                setCaseStudies([...caseStudies, { title: '', description: '', results: '' }])
              }
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Case Study
            </Button>
          </CardContent>
        </Card>

        {/* Follow-up Sequence */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Follow-up Sequence</CardTitle>
            <CardDescription>Configure automated follow-up timing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 space-y-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={useDefaultSequence}
                  onChange={() => setUseDefaultSequence(true)}
                />
                <span className="font-medium">Use Default Sequence</span>
              </label>
              <p className="ml-6 text-sm text-gray-600">Day 1, Day 3, Day 10 follow-ups</p>

              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={!useDefaultSequence}
                  onChange={() => setUseDefaultSequence(false)}
                />
                <span className="font-medium">Custom Sequence</span>
              </label>
            </div>

            {!useDefaultSequence && (
              <div className="space-y-3">
                {customSequence.map((step, index) => (
                  <div key={index} className="flex gap-3 items-center">
                    <Input
                      type="number"
                      value={step.delay_days}
                      onChange={(e) => {
                        const newSeq = [...customSequence];
                        newSeq[index].delay_days = parseInt(e.target.value) || 1;
                        setCustomSequence(newSeq);
                      }}
                      className="w-24"
                      min="1"
                    />
                    <span className="text-sm">days</span>
                    <select
                      value={step.type}
                      onChange={(e) => {
                        const newSeq = [...customSequence];
                        newSeq[index].type = e.target.value;
                        setCustomSequence(newSeq);
                      }}
                      className="flex-1 rounded-md border border-gray-300 px-3 py-2"
                    >
                      <option value="value_driven">Value Driven</option>
                      <option value="close_up">Close Up</option>
                    </select>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => router.push('/agents')}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
