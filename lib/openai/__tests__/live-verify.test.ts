/**
 * Live verification test — combines:
 *   1. Categorizer re-classification of the three missed-reply screenshot cases
 *   2. Backfill query against Supabase to find leads stuck by the pre-fix bugs
 *
 * Reads credentials from .env.local. Fetches an active agent's OpenAI key
 * from the `agents` table to exercise the fixed categorizer prompt.
 *
 * Run: npx vitest run lib/openai/__tests__/live-verify.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { categorizeReply } from '../categorizer';

// ── Load .env.local manually (vitest does not auto-load) ────────────────────
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const contents = fs.readFileSync(envPath, 'utf8');
  for (const line of contents.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

// Guard: this test hits live Supabase + OpenAI. Only runs when LIVE_TESTS=1.
const LIVE = process.env.LIVE_TESTS === '1';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let openaiKey: string | null = null;
let agentId: string | null = null;
let agentName: string | null = null;

describe.skipIf(!LIVE)('live verification', () => {
  beforeAll(async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      throw new Error('SUPABASE env not set');
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const { data, error } = await supabase
      .from('agents')
      .select('id, name, openai_api_key, ai_provider, ai_model')
      .not('openai_api_key', 'is', null)
      .eq('is_active', true)
      .limit(5);

    if (error) throw error;
    const agent = (data || []).find((a: any) => a.openai_api_key && a.openai_api_key.length > 10);
    if (!agent) throw new Error('No active agent with OpenAI key found');

    openaiKey = (agent as any).openai_api_key;
    agentId = (agent as any).id;
    agentName = (agent as any).name;
    console.log(`[setup] using agent "${agentName}" (${agentId})`);
  }, 30000);

  const cases = [
    {
      name: 'confused "who is Angela?"',
      expectInterested: true,
      reply_subject: 'Re: New media relations role',
      reply_body: `Well thank you, but who is Angela?
-----Original Message-----
From: Aurora Hall <aurora.hall@assocfpo.org>
Sent: Wednesday, April 8, 2026 5:38 PM
To: Angela Kelley <ed@edbride-pr.com>
Subject: New media relations role

Hey Angela,

We're selectively onboarding three companies this spring to produce 3-5 high-ticket clients every month through cold email, on a commission-based model as part of our spring pilot.

We handle everything, from lead research, email copywriting, and outreach sequencing to outreach and meeting setup, so your job is just to close deals.

On average, our partners see 12-18 sales-qualified meetings every month.

Down to learning more?

BR,
Aurora
RGL Growth team

P.S. Congrats on your new role with Apexon. Sounds like you're driving some serious media outreach. :)`,
      original_status: 'not_interested',
    },
    {
      name: '"No retainer" + "Yes am interested"',
      expectInterested: true,
      reply_subject: 'Re: pay-per-closed-client test?',
      reply_body: `No retainer

Thanks & Regards
Pooja Sharma
CEO/Founder
The Talent Mappers

On Sat, Apr 11, 2026 at 5:04PM Pooja Sharma <p.sharma@thetalentmappers.com> wrote:
Yes am interested pls share details

Thanks & Regards
Pooja Sharma
CEO/Founder
The Talent Mappers

On Sat, Apr 11, 2026 at 2:58 AM Isla Belle wrote:
Hi Pooja, we work pay-per-closed-client with selected partners — interested?`,
      original_status: 'not_interested',
    },
    {
      name: 'qualifying questions about sales and SAAS',
      expectInterested: true,
      reply_subject: 'Re: pay-per-closed-client test?',
      reply_body: `What if I'm not good at sales?
And do you do this for SAAS products?

Regards,
Calvin Gomes
Owner
www.primerjobs.com`,
      original_status: 'not_interested',
    },
    {
      name: 'control: explicit rejection',
      expectInterested: false,
      reply_subject: 'Re: quick intro',
      reply_body: 'Not interested, please remove me from your list.',
      original_status: 'not_interested',
    },
    {
      name: 'control: explicit interest',
      expectInterested: true,
      reply_subject: 'Re: quick intro',
      reply_body: "Sounds interesting, what's the next step?",
      original_status: 'interested',
    },
  ];

  for (const c of cases) {
    it(
      `categorizer: ${c.name}`,
      async () => {
        const result = await categorizeReply({
          reply: {
            reply_body: c.reply_body,
            reply_subject: c.reply_subject,
            original_status: c.original_status,
          },
          openaiApiKey: openaiKey!,
          aiProvider: 'openai',
          aiModel: 'gpt-4o-mini',
        });
        const summary = `is_interested=${result.is_truly_interested} conf=${result.confidence_score}`;
        const reason = (result.reasoning || '').slice(0, 200);
        console.log(`  [${c.name}] ${summary} :: ${reason}`);
        expect(result.is_truly_interested).toBe(c.expectInterested);
      },
      60000
    );
  }

  it(
    'backfill: count leads parked by pre-fix bugs',
    async () => {
      const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

      const { data: parked, error: parkedErr } = await supabase
        .from('interested_leads')
        .select('id, agent_id, lead_email, conversation_status, needs_approval, next_followup_due_at, followup_stage, last_response_sent_at, updated_at', {
          count: 'exact',
        })
        .is('next_followup_due_at', null)
        .eq('needs_approval', true);
      if (parkedErr) throw parkedErr;

      const { data: unresponsive, error: unrErr } = await supabase
        .from('interested_leads')
        .select('id, agent_id, lead_email', { count: 'exact' })
        .eq('conversation_status', 'unresponsive');
      if (unrErr) throw unrErr;

      console.log('\n=== BACKFILL REPORT ===');
      console.log(`Leads parked (needs_approval=true AND next_followup_due_at=NULL): ${parked?.length ?? 0}`);
      console.log(`Leads in legacy 'unresponsive' status: ${unresponsive?.length ?? 0}`);

      const byAgent = new Map<string, number>();
      for (const lead of parked || []) {
        byAgent.set((lead as any).agent_id, (byAgent.get((lead as any).agent_id) || 0) + 1);
      }
      console.log('\nParked leads by agent:');
      for (const [aid, count] of byAgent.entries()) {
        const { data: a } = await supabase.from('agents').select('name').eq('id', aid).single();
        console.log(`  ${(a as any)?.name || aid}: ${count}`);
      }

      // Sanity: at least the query runs and returns counts
      expect(Array.isArray(parked)).toBe(true);
      expect(Array.isArray(unresponsive)).toBe(true);
    },
    60000
  );
});
