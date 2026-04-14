/**
 * Breakdown of parked leads by followup_stage to understand where they're stuck.
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

// Guard: queries live Supabase. Only runs when LIVE_TESTS=1.
const LIVE = process.env.LIVE_TESTS === '1';

describe.skipIf(!LIVE)('parked leads diagnostic', () => {
  it('breaks down parked leads by followup_stage and RGL-specific', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data, error } = await supabase
      .from('interested_leads')
      .select('id, agent_id, lead_email, followup_stage, last_response_sent, last_response_sent_at, created_at, updated_at')
      .is('next_followup_due_at', null)
      .eq('needs_approval', true);
    if (error) throw error;

    const stages = new Map<number, number>();
    const everSent = { yes: 0, no: 0 };
    for (const lead of data || []) {
      const s = (lead as any).followup_stage ?? 0;
      stages.set(s, (stages.get(s) || 0) + 1);
      if ((lead as any).last_response_sent_at) everSent.yes++;
      else everSent.no++;
    }
    console.log('\n=== PARKED LEADS BREAKDOWN ===');
    console.log(`Total: ${data?.length ?? 0}`);
    console.log(`Stage distribution:`);
    for (const [s, c] of Array.from(stages.entries()).sort((a, b) => a[0] - b[0])) {
      console.log(`  followup_stage=${s}: ${c} leads`);
    }
    console.log(`Ever-sent (last_response_sent_at set):`);
    console.log(`  yes (at least initial sent): ${everSent.yes}`);
    console.log(`  no  (initial response held, never sent): ${everSent.no}`);

    // RGL Campaigns specific
    const { data: rgl, error: rglErr } = await supabase
      .from('agents')
      .select('id, name')
      .ilike('name', '%RGL campaigns%')
      .limit(1)
      .maybeSingle();
    if (rglErr) throw rglErr;
    if (rgl) {
      const rglLeads = (data || []).filter((l: any) => l.agent_id === (rgl as any).id);
      console.log(`\nRGL Campaigns specifically: ${rglLeads.length} parked`);
      const rglStages = new Map<number, number>();
      for (const l of rglLeads) {
        const s = (l as any).followup_stage ?? 0;
        rglStages.set(s, (rglStages.get(s) || 0) + 1);
      }
      for (const [s, c] of Array.from(rglStages.entries()).sort()) {
        console.log(`  stage=${s}: ${c}`);
      }
      // Oldest / newest
      const sorted = [...rglLeads].sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      if (sorted.length) {
        console.log(`  oldest stuck: ${(sorted[0] as any).created_at} (${(sorted[0] as any).lead_email})`);
        console.log(`  newest stuck: ${(sorted[sorted.length - 1] as any).created_at} (${(sorted[sorted.length - 1] as any).lead_email})`);
      }
    }
  }, 60000);
});
