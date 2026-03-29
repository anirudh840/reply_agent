import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Reference - Reply Agent',
  description: 'External API documentation for accessing responded leads and campaign metrics.',
};

function CodeBlock({ children, title }: { children: string; title?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      {title && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2 text-xs font-medium text-gray-500">
          {title}
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-sm bg-gray-900 text-gray-100">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Badge({ children, color = 'green' }: { children: string; color?: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-100 text-green-800',
    blue: 'bg-blue-100 text-blue-800',
    yellow: 'bg-yellow-100 text-yellow-800',
    gray: 'bg-gray-100 text-gray-800',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${colors[color]}`}>
      {children}
    </span>
  );
}

function ParamRow({ name, type, required, children }: {
  name: string;
  type: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <tr className="border-b border-gray-100">
      <td className="py-3 pr-4 align-top">
        <code className="text-sm font-mono font-medium text-gray-900">{name}</code>
        {required && <span className="ml-1 text-red-500 text-xs">*</span>}
      </td>
      <td className="py-3 pr-4 align-top">
        <Badge color="gray">{type}</Badge>
      </td>
      <td className="py-3 text-sm text-gray-600">{children}</td>
    </tr>
  );
}

export default function ApiReferencePage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">Reply Agent API</h1>
            <Badge color="blue">v1</Badge>
          </div>
          <p className="text-gray-600">
            Access your responded leads and campaign metrics from external apps.
            Track <strong>real positives</strong> — leads that were actually replied to — not just AI-classified interested leads.
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-16">

        {/* Authentication */}
        <section id="auth">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Authentication</h2>
          <p className="text-gray-600 mb-4">
            All API requests require a Bearer token. Create API keys from the{' '}
            <a href="/dashboard/api-keys" className="text-blue-600 hover:underline">API Keys</a>{' '}
            page in your dashboard.
          </p>
          <CodeBlock title="Request header">
            {`Authorization: Bearer eb_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
          </CodeBlock>
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
            API keys are shown once at creation. If you lose a key, revoke it and create a new one.
          </div>
        </section>

        {/* Base URL */}
        <section id="base-url">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Base URL</h2>
          <CodeBlock>
            {`https://reply-agent-mu.vercel.app`}
          </CodeBlock>
        </section>

        {/* Campaign Metrics */}
        <section id="campaigns-metrics">
          <div className="flex items-center gap-3 mb-2">
            <Badge color="green">GET</Badge>
            <h2 className="text-xl font-bold text-gray-900">/api/v1/campaigns/metrics</h2>
          </div>
          <p className="text-gray-600 mb-6">
            Returns per-campaign counts of leads that were <strong>actually responded to</strong> (real positives),
            along with AI-classified interested counts and meetings booked.
          </p>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Query Parameters</h3>
          <table className="w-full mb-6">
            <tbody>
              <ParamRow name="agent_id" type="uuid">Filter to a specific agent.</ParamRow>
              <ParamRow name="since" type="ISO date">Only include data after this date. Example: <code className="text-xs bg-gray-100 px-1 rounded">2026-01-01</code></ParamRow>
              <ParamRow name="until" type="ISO date">Only include data before this date.</ParamRow>
            </tbody>
          </table>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Example Request</h3>
          <CodeBlock title="curl">
{`curl -H "Authorization: Bearer eb_live_xxx..." \\
  "https://reply-agent-mu.vercel.app/api/v1/campaigns/metrics?since=2026-01-01"`}
          </CodeBlock>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mt-6 mb-3">Response</h3>
          <CodeBlock title="200 OK">
{`{
  "campaigns": [
    {
      "campaign_id": "camp_abc123",
      "agent_id": "agt_uuid",
      "agent_name": "Sales Agent",
      "total_replies": 42,
      "interested_count": 12,
      "responded_count": 9,
      "meetings_booked": 3
    }
  ],
  "totals": {
    "total_replies": 42,
    "interested_count": 12,
    "responded_count": 9,
    "meetings_booked": 3
  }
}`}
          </CodeBlock>

          <div className="mt-4 space-y-2 text-sm text-gray-600">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Response Fields</h3>
            <table className="w-full">
              <tbody>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-900">responded_count</td>
                  <td className="py-2">Leads that were actually replied to — your <strong>real positives</strong>.</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-900">interested_count</td>
                  <td className="py-2">Leads AI-classified as interested (EmailBison&apos;s classification, may miss ~50%).</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-900">total_replies</td>
                  <td className="py-2">All replies received (interested + not interested + OOO + automated).</td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 pr-4 font-mono text-xs text-gray-900">meetings_booked</td>
                  <td className="py-2">Meetings booked via booking integration.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Responded Leads */}
        <section id="leads-responded">
          <div className="flex items-center gap-3 mb-2">
            <Badge color="green">GET</Badge>
            <h2 className="text-xl font-bold text-gray-900">/api/v1/leads/responded</h2>
          </div>
          <p className="text-gray-600 mb-6">
            Returns a paginated list of leads that received a response (real positives), with campaign info,
            lead details, and conversation status.
          </p>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Query Parameters</h3>
          <table className="w-full mb-6">
            <tbody>
              <ParamRow name="agent_id" type="uuid">Filter to a specific agent.</ParamRow>
              <ParamRow name="campaign_id" type="string">Filter to a specific campaign.</ParamRow>
              <ParamRow name="since" type="ISO date">Only include leads responded after this date.</ParamRow>
              <ParamRow name="until" type="ISO date">Only include leads responded before this date.</ParamRow>
              <ParamRow name="status" type="string">
                Conversation status filter. One of: <code className="text-xs bg-gray-100 px-1 rounded">active</code>{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">completed</code>{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">paused</code>{' '}
                <code className="text-xs bg-gray-100 px-1 rounded">unresponsive</code>
              </ParamRow>
              <ParamRow name="page" type="integer">Page number (default: 1).</ParamRow>
              <ParamRow name="per_page" type="integer">Items per page (default: 50, max: 200).</ParamRow>
            </tbody>
          </table>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Example Request</h3>
          <CodeBlock title="curl">
{`curl -H "Authorization: Bearer eb_live_xxx..." \\
  "https://reply-agent-mu.vercel.app/api/v1/leads/responded?campaign_id=camp_abc123&page=1&per_page=20"`}
          </CodeBlock>

          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mt-6 mb-3">Response</h3>
          <CodeBlock title="200 OK">
{`{
  "data": [
    {
      "id": "lead_uuid",
      "lead_email": "john@company.com",
      "lead_name": "John Smith",
      "lead_company": "Acme Corp",
      "campaign_id": "camp_abc123",
      "agent_id": "agt_uuid",
      "agent_name": "Sales Agent",
      "first_responded_at": "2026-03-15T10:30:00Z",
      "last_response_sent_at": "2026-03-15T10:31:00Z",
      "conversation_status": "active",
      "followup_stage": 1,
      "has_meeting_booked": false,
      "original_reply_subject": "Re: Quick question",
      "original_reply_body": "Sure, I'd love to learn more...",
      "response_sent": "Thanks for your interest, John! ..."
    }
  ],
  "total": 9,
  "page": 1,
  "per_page": 20,
  "total_pages": 1
}`}
          </CodeBlock>
        </section>

        {/* Errors */}
        <section id="errors">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Errors</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-700">Status</th>
                <th className="py-2 text-left font-medium text-gray-700">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><Badge color="yellow">401</Badge></td>
                <td className="py-2 text-gray-600">Invalid or missing API key.</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><Badge color="yellow">403</Badge></td>
                <td className="py-2 text-gray-600">API key lacks the required scope (e.g. <code className="text-xs bg-gray-100 px-1 rounded">read:campaigns</code>).</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4"><Badge color="yellow">500</Badge></td>
                <td className="py-2 text-gray-600">Internal server error. Response body contains <code className="text-xs bg-gray-100 px-1 rounded">error</code> message.</td>
              </tr>
            </tbody>
          </table>
          <CodeBlock title="Error response format">
{`{
  "error": "Invalid or missing API key. Use Authorization: Bearer <your_api_key>"
}`}
          </CodeBlock>
        </section>

        {/* Rate Limits / Scopes */}
        <section id="scopes">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Scopes</h2>
          <p className="text-gray-600 mb-4">
            Each API key is created with permission scopes. By default, keys get both scopes.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 text-left font-medium text-gray-700">Scope</th>
                <th className="py-2 text-left font-medium text-gray-700">Grants access to</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs">read:campaigns</td>
                <td className="py-2 text-gray-600"><code className="text-xs bg-gray-100 px-1 rounded">GET /api/v1/campaigns/metrics</code></td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-mono text-xs">read:leads</td>
                <td className="py-2 text-gray-600"><code className="text-xs bg-gray-100 px-1 rounded">GET /api/v1/leads/responded</code></td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Quick Start */}
        <section id="quickstart" className="pb-10">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Start</h2>
          <div className="space-y-4 text-sm text-gray-600">
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center">1</span>
              <p>Go to <a href="/dashboard/api-keys" className="text-blue-600 hover:underline">Dashboard &gt; API Keys</a> and create a key.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center">2</span>
              <p>Copy the key (shown once) and store it securely.</p>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center">3</span>
              <div>
                <p className="mb-2">Fetch your real positives per campaign:</p>
                <CodeBlock>
{`curl -H "Authorization: Bearer eb_live_xxx..." \\
  "https://reply-agent-mu.vercel.app/api/v1/campaigns/metrics"`}
                </CodeBlock>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-900 text-white text-xs flex items-center justify-center">4</span>
              <p>Use <code className="bg-gray-100 px-1 rounded">responded_count</code> as your real &quot;Emails Per Positive&quot; metric in your external dashboard.</p>
            </div>
          </div>
        </section>
      </div>

      <footer className="border-t border-gray-200 py-6 text-center text-xs text-gray-400">
        Reply Agent API v1
      </footer>
    </div>
  );
}
