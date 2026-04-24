/**
 * Specifically check why RGL active leads are stuck at followup_stage=0.
 * Dump next_followup_due_at, last_response_sent_at, needs_approval for all.
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

describe.skipIf(!LIVE)('RGL stage detail', () => {
  it('prints full state for every active RGL lead', async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: agent } = await supabase.from('agents').select('id, followup_sequence, mode, confidence_threshold').ilike('name', '%RGL campaigns%').single();
    const a = agent as any;
    console.log('mode:', a.mode, 'threshold:', a.confidence_threshold);
    console.log('sequence:', JSON.stringify(a.followup_sequence));

    const { data: leads } = await supabase
      .from('interested_leads')
      .select('lead_email, conversation_status, needs_approval, followup_stage, next_followup_due_at, last_response_sent_at, last_response_generated, response_confidence_score, last_lead_reply_at, approval_reason, created_at')
      .eq('agent_id', a.id)
      .order('created_at', { ascending: false });

    console.log(`\ntotal RGL leads: ${leads?.length ?? 0}`);
    let neverSent = 0, sentNoFollowup = 0, scheduled = 0, complete = 0, parked = 0;
    for (const l of leads || []) {
      const L = l as any;
      const wasSent = !!L.last_response_sent_at;
      const scheduledFollowup = !!L.next_followup_due_at;
      if (L.conversation_status === 'completed') complete++;
      else if (L.needs_approval) parked++;
      else if (!wasSent) neverSent++;
      else if (!scheduledFollowup) sentNoFollowup++;
      else scheduled++;
    }
    console.log(`  completed: ${complete}`);
    console.log(`  parked (needs_approval=true): ${parked}`);
    console.log(`  never_sent (last_response_sent_at=null, not parked): ${neverSent}`);
    console.log(`  sent_but_no_followup_scheduled: ${sentNoFollowup}`);
    console.log(`  scheduled_for_followup: ${scheduled}`);

    console.log('\n--- never_sent leads (where response was generated but never sent) ---');
    for (const l of leads || []) {
      const L = l as any;
      if (L.conversation_status !== 'completed' && !L.needs_approval && !L.last_response_sent_at && L.last_response_generated) {
        console.log(`${L.lead_email}  status=${L.conversation_status} generated=${!!L.last_response_generated} sent=${!!L.last_response_sent_at} conf=${L.response_confidence_score} reason="${(L.approval_reason || '').slice(0, 100)}"`);
      }
    }

    console.log('\n--- sent_but_no_followup_scheduled leads ---');
    for (const l of leads || []) {
      const L = l as any;
      if (L.conversation_status !== 'completed' && !L.needs_approval && L.last_response_sent_at && !L.next_followup_due_at) {
        console.log(`${L.lead_email}  sent=${L.last_response_sent_at} stage=${L.followup_stage}`);
      }
    }

    console.log('\n--- scheduled for followup (should fire) ---');
    for (const l of leads || []) {
      const L = l as any;
      if (L.next_followup_due_at) {
        const due = new Date(L.next_followup_due_at);
        const overdue = due.getTime() < Date.now();
        console.log(`${L.lead_email}  due=${L.next_followup_due_at} stage=${L.followup_stage}${overdue ? ' [OVERDUE]' : ''}`);
      }
    }
  }, 120000);
});
