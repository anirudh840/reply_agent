/**
 * Post-deploy verification. Answers:
 *  - Has the hourly cron fired since deploy?
 *  - What is RGL's confidence_threshold (is it set high enough to hold auto-mode followups)?
 *  - Are there any followup sends recorded in the last 2 hours?
 *  - Send-log table state — any new followup entries?
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

describe.skipIf(!LIVE)('post-deploy verify', () => {
  it('RGL config + recent followup activity', async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, mode, confidence_threshold, followup_sequence, is_active')
      .eq('is_active', true);
    console.log('\n=== ACTIVE AGENT CONFIG ===');
    for (const a of agents || []) {
      const A = a as any;
      console.log(`${A.name}: mode=${A.mode}, threshold=${A.confidence_threshold}, steps=${A.followup_sequence?.steps?.length || 0}`);
    }

    const since2h = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { data: recentSends, error: sendErr } = await supabase
      .from('send_log')
      .select('*')
      .gte('created_at', since2h)
      .order('created_at', { ascending: false })
      .limit(50);
    console.log('\n=== SEND LOG LAST 2h ===');
    if (sendErr) {
      console.log('send_log query failed:', sendErr.message);
    } else {
      console.log(`total entries: ${recentSends?.length ?? 0}`);
      for (const r of (recentSends || []).slice(0, 20)) {
        const R = r as any;
        console.log(`[${R.created_at}] source=${R.send_source} status=${R.status} lead_email=${R.lead_email}`);
      }
    }

    const { data: recentLeadUpdates } = await supabase
      .from('interested_leads')
      .select('lead_email, agent_id, followup_stage, last_response_sent_at, next_followup_due_at, conversation_status, updated_at')
      .gte('updated_at', since2h)
      .order('updated_at', { ascending: false })
      .limit(50);
    console.log('\n=== LEAD UPDATES LAST 2h ===');
    console.log(`total: ${recentLeadUpdates?.length ?? 0}`);
    for (const l of (recentLeadUpdates || []).slice(0, 20)) {
      const L = l as any;
      console.log(`[${L.updated_at}] ${L.lead_email} stage=${L.followup_stage} status=${L.conversation_status} last_sent=${L.last_response_sent_at}`);
    }

    // RGL overdue count right now
    const { data: agent } = await supabase.from('agents').select('id').ilike('name', '%RGL campaigns%').single();
    const rglId = (agent as any).id;
    const { count } = await supabase
      .from('interested_leads')
      .select('id', { count: 'exact', head: true })
      .eq('agent_id', rglId)
      .eq('conversation_status', 'active')
      .not('next_followup_due_at', 'is', null)
      .lte('next_followup_due_at', new Date().toISOString());
    console.log(`\n=== RGL OVERDUE LEADS RIGHT NOW: ${count} ===`);
  }, 120000);
});
