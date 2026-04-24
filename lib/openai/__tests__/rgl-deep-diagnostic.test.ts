/**
 * Deep diagnostic for RGL Campaigns — two reports:
 *   A. Objection state now vs April 7 snapshot, plus any recoverable text
 *      stored in knowledge_base_embeddings content_text.
 *   B. Reply/lead reconciliation for the last 14 days. Finds replies whose
 *      from_email has no corresponding interested_leads row for the same
 *      agent, and leads whose conversation_status / needs_approval combos
 *      would hide them from the inbox.
 *
 * Run: LIVE_TESTS=1 npx vitest run lib/openai/__tests__/rgl-deep-diagnostic.test.ts --reporter=verbose
 */
import fs from 'fs';
import path from 'path';
import { describe, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const LIVE = process.env.LIVE_TESTS === '1';
const RGL_NAME_MATCH = '%RGL campaigns%';

describe.skipIf(!LIVE)('RGL deep diagnostic', () => {
  it('objection state + recovery candidates', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: agent, error: aErr } = await supabase
      .from('agents')
      .select('*')
      .ilike('name', RGL_NAME_MATCH)
      .single();
    if (aErr) throw aErr;
    const a = agent as any;

    console.log('\n=== RGL AGENT STATE ===');
    console.log('id:', a.id);
    console.log('name:', a.name);
    console.log('mode:', a.mode);
    console.log('is_active:', a.is_active);
    console.log('created_at:', a.created_at);
    console.log('updated_at:', a.updated_at);
    console.log('workspace_id:', a.emailbison_workspace_id);
    console.log('platform:', a.platform);
    console.log('webhook_id:', a.webhook_id);

    const oh = a.objection_handling || {};
    console.log('\n--- objection_handling shape ---');
    console.log('has common_objections array:', Array.isArray(oh.common_objections));
    console.log('current count:',
      Array.isArray(oh.common_objections) ? oh.common_objections.length
      : Object.keys(oh).filter(k => k !== 'common_objections').length
    );

    if (Array.isArray(oh.common_objections)) {
      oh.common_objections.forEach((e: any, i: number) => {
        const o = (e.objection || '').slice(0, 80);
        const r = (e.response || '').slice(0, 80);
        console.log(`  ${i+1}. OBJ: "${o}"  |  RES: "${r}"`);
      });
    }

    // Recovery candidates: any stored embedding text for this agent
    const { data: embs } = await supabase
      .from('knowledge_base_embeddings')
      .select('content_type, content_text, created_at, metadata')
      .eq('agent_id', a.id)
      .order('created_at', { ascending: false });

    console.log(`\n--- embeddings (${embs?.length ?? 0}) ---`);
    for (const e of embs || []) {
      const preview = String((e as any).content_text || '').slice(0, 300).replace(/\n/g, ' | ');
      console.log(`[${(e as any).content_type}] ${(e as any).created_at} :: ${preview}`);
    }
  }, 120000);

  it('reply + lead reconciliation for last 14 days', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: agent } = await supabase
      .from('agents').select('id, name').ilike('name', RGL_NAME_MATCH).single();
    const agentId = (agent as any).id;

    const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();

    const { data: replies } = await supabase
      .from('replies')
      .select('id, emailbison_reply_id, lead_email, reply_subject, received_at, is_truly_interested, ai_confidence_score, ai_reasoning, corrected_status, processing_status')
      .eq('agent_id', agentId)
      .gte('received_at', since)
      .order('received_at', { ascending: false });

    const { data: leads } = await supabase
      .from('interested_leads')
      .select('id, lead_email, conversation_status, needs_approval, followup_stage, next_followup_due_at, last_response_sent_at, last_lead_reply_at, created_at, updated_at')
      .eq('agent_id', agentId)
      .gte('created_at', since)
      .order('created_at', { ascending: false });

    const leadByEmail = new Map<string, any>();
    for (const l of leads || []) leadByEmail.set(String((l as any).lead_email).toLowerCase(), l);

    console.log('\n=== REPLIES (14d) ===');
    console.log(`total replies stored: ${replies?.length ?? 0}`);

    let interestedCount = 0;
    let notInterestedCount = 0;
    let missingLead = 0;
    const byDay = new Map<string, number>();

    for (const r of replies || []) {
      const day = new Date((r as any).received_at).toISOString().slice(0,10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
      if ((r as any).is_truly_interested) interestedCount++;
      else notInterestedCount++;
      const email = String((r as any).lead_email || '').toLowerCase();
      if (!leadByEmail.has(email)) missingLead++;
    }

    console.log(`interested: ${interestedCount}`);
    console.log(`not_interested: ${notInterestedCount}`);
    console.log(`replies with NO matching interested_lead row: ${missingLead}`);
    console.log('by day:', Array.from(byDay.entries()).sort().map(([d,c]) => `${d}=${c}`).join(', '));

    console.log('\n=== LEADS (14d) ===');
    console.log(`total leads created: ${leads?.length ?? 0}`);
    const byStatus = new Map<string, number>();
    for (const l of leads || []) {
      const s = (l as any).conversation_status;
      byStatus.set(s, (byStatus.get(s) || 0) + 1);
    }
    for (const [s, c] of byStatus) console.log(`  status=${s}: ${c}`);

    const parked = (leads || []).filter((l: any) => l.needs_approval === true && !l.next_followup_due_at);
    console.log(`parked (needs_approval=true, next_followup_due_at=null): ${parked.length}`);

    const paused = (leads || []).filter((l: any) => l.conversation_status === 'paused');
    console.log(`paused (categorizer said not_interested): ${paused.length}`);

    // Replies in the last 72h specifically
    const since72 = Date.now() - 72 * 3600 * 1000;
    const recent = (replies || []).filter((r: any) => new Date(r.received_at).getTime() >= since72);
    console.log(`\n=== RECENT 72h REPLIES (${recent.length}) ===`);
    for (const r of recent) {
      const lead = leadByEmail.get(String((r as any).lead_email).toLowerCase());
      console.log(
        `[${(r as any).received_at}] ${(r as any).lead_email}  ` +
        `interested=${(r as any).is_truly_interested ? 'Y' : 'N'} ` +
        `conf=${(r as any).ai_confidence_score} ` +
        `lead_status=${lead?.conversation_status ?? 'NONE'} ` +
        `needs_approval=${lead?.needs_approval ?? 'N/A'} ` +
        `next_due=${lead?.next_followup_due_at ?? 'null'}`
      );
      console.log(`   subject: ${String((r as any).reply_subject || '').slice(0, 80)}`);
      console.log(`   reasoning: ${String((r as any).ai_reasoning || '').slice(0, 200)}`);
    }
  }, 180000);

  it('sanity: inbox query for RGL (same query the UI uses)', async () => {
    // Mirror app/api/leads/route.ts default behavior for the RGL agent
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: agent } = await supabase
      .from('agents').select('id').ilike('name', RGL_NAME_MATCH).single();
    const agentId = (agent as any).id;

    const { data: all } = await supabase
      .from('interested_leads')
      .select('id, lead_email, conversation_status, needs_approval, followup_stage, next_followup_due_at, last_lead_reply_at, last_response_sent_at, created_at', { count: 'exact' })
      .eq('agent_id', agentId)
      .order('last_lead_reply_at', { ascending: false, nullsFirst: false })
      .limit(100);

    console.log(`\n=== RGL LEADS (inbox view, top 100 by last_lead_reply_at) ===`);
    console.log(`total returned: ${all?.length ?? 0}`);
    for (const l of (all || []).slice(0, 25)) {
      const last = (l as any).last_lead_reply_at || (l as any).created_at;
      console.log(
        `[${last}] ${(l as any).lead_email}  ` +
        `status=${(l as any).conversation_status} ` +
        `needs_approval=${(l as any).needs_approval} ` +
        `stage=${(l as any).followup_stage}`
      );
    }
  }, 120000);
});
