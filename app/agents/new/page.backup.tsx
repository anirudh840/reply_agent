'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ArrowRight, Loader2, Plus, Trash2, Check } from 'lucide-react';
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
        router.push('/agents');
      } else {
        alert(data.error || 'Failed to create agent');
      }
    } catch (error) {
      console.error('Error creating agent:', error);
      alert('Failed to create agent');
    } finally {
      setLoading(false);
    }
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return true; // Mode is always selected
      case 2:
        return name.trim() && emailbisonApiKey.trim() && openaiApiKey.trim();
      case 3:
        return companyInfo.trim() || productDescription.trim();
      case 4:
        return true; // Follow-up sequence is optional
      case 5:
        return true; // Review step
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
                Get from: mail.revgenlabs.com/api
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

            <div>
              <label className="mb-2 block text-sm font-medium">
                Objection Handling (Optional)
              </label>
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

            <div>
              <label className="mb-2 block text-sm font-medium">
                Case Studies (Optional)
              </label>
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
              <h2 className="mb-2 text-2xl font-bold">Review & Create</h2>
              <p className="text-gray-600">
                Review your agent configuration before creating
              </p>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border p-4">
                <h3 className="mb-2 font-semibold">Basic Info</h3>
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="inline font-medium">Name:</dt>{' '}
                    <dd className="inline">{name}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Mode:</dt>{' '}
                    <dd className="inline">
                      {mode === 'fully_automated'
                        ? 'Fully Automated'
                        : 'Human in Loop'}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Timezone:</dt>{' '}
                    <dd className="inline">{timezone}</dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border p-4">
                <h3 className="mb-2 font-semibold">Knowledge Base</h3>
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="font-medium">Company Info:</dt>
                    <dd className="text-gray-600">
                      {companyInfo || 'Not provided'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Product Description:</dt>
                    <dd className="text-gray-600">
                      {productDescription || 'Not provided'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium">Value Propositions:</dt>
                    <dd className="text-gray-600">
                      {valueProps.filter((v) => v.trim()).length} added
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="rounded-md border p-4">
                <h3 className="mb-2 font-semibold">Follow-up Configuration</h3>
                <dl className="space-y-1 text-sm">
                  <div>
                    <dt className="inline font-medium">Confidence Threshold:</dt>{' '}
                    <dd className="inline">{confidenceThreshold}/10</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">Sequence:</dt>{' '}
                    <dd className="inline">
                      {useDefaultSequence ? 'Default (3 steps)' : 'Custom'}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        );
    }
  };

  const steps = [
    { number: 1, name: 'Mode' },
    { number: 2, name: 'API Keys' },
    { number: 3, name: 'Knowledge' },
    { number: 4, name: 'Follow-ups' },
    { number: 5, name: 'Review' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>

        {/* Progress Steps */}
        <div className="mb-8 flex items-center justify-between">
          {steps.map((step, idx) => (
            <div key={step.number} className="flex items-center">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
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
                className={`ml-2 text-sm font-medium ${
                  currentStep >= step.number ? 'text-gray-900' : 'text-gray-400'
                }`}
              >
                {step.name}
              </span>
              {idx < steps.length - 1 && (
                <div
                  className={`mx-4 h-0.5 w-12 ${
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
