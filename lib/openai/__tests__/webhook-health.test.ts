/**
 * Webhook health check: when did each agent last receive a reply?
 * If RGL is dark but other agents are live, it's an RGL-specific config
 * problem. If every agent went dark, it's a system-wide webhook issue.
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

describe.skipIf(!LIVE)('webhook health', () => {
  it('reports last reply time per agent', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, is_active, webhook_id, emailbison_workspace_id, platform, emailbison_api_key, created_at')
      .order('created_at', { ascending: false });

    console.log('\n=== WEBHOOK HEALTH (all agents) ===');
    for (const a of agents || []) {
      const agent = a as any;
      const { data: lastReply } = await supabase
        .from('replies')
        .select('received_at, lead_email, is_truly_interested')
        .eq('agent_id', agent.id)
        .order('received_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count: total7d } = await supabase
        .from('replies')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', agent.id)
        .gte('received_at', new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString());

      const last = lastReply as any;
      const lastAt = last?.received_at;
      const daysAgo = lastAt ? Math.floor((Date.now() - new Date(lastAt).getTime()) / (24 * 3600 * 1000)) : null;
      console.log(
        `${agent.is_active ? '✓' : '✗'} ${agent.name}  ` +
        `(active=${agent.is_active}, platform=${agent.platform}, workspace=${agent.emailbison_workspace_id || 'null'}) ` +
        `last_reply=${lastAt || 'NEVER'}${daysAgo !== null ? ` (${daysAgo}d ago)` : ''}  ` +
        `last_7d_count=${total7d ?? 0}  ` +
        `webhook=/api/webhooks/${agent.webhook_id}  ` +
        `has_api_key=${!!agent.emailbison_api_key}`
      );
    }
  }, 180000);

  it('any replies SYSTEM-WIDE in last 24h?', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const since24 = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data, count } = await supabase
      .from('replies')
      .select('agent_id, lead_email, received_at', { count: 'exact' })
      .gte('received_at', since24)
      .order('received_at', { ascending: false });
    console.log(`\n=== SYSTEM-WIDE LAST 24h ===`);
    console.log(`total replies across ALL agents in last 24h: ${count ?? 0}`);
    for (const r of (data || []).slice(0, 20)) {
      console.log(`  [${(r as any).received_at}] agent=${(r as any).agent_id} from=${(r as any).lead_email}`);
    }
  }, 120000);

  it('EmailBison API keys present?', async () => {
    // Just confirm RGL and others have API keys set. Not printing keys.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await supabase
      .from('agents')
      .select('id, name, is_active, emailbison_api_key, webhook_id, emailbison_workspace_id')
      .eq('is_active', true);
    console.log('\n=== ACTIVE AGENT CONFIGS ===');
    for (const a of data || []) {
      const agent = a as any;
      console.log(
        `${agent.name}: api_key=${agent.emailbison_api_key ? 'set' : 'MISSING'} ` +
        `workspace_id=${agent.emailbison_workspace_id || 'null'} ` +
        `webhook_id=${agent.webhook_id || 'MISSING'}`
      );
    }
  }, 60000);
});
