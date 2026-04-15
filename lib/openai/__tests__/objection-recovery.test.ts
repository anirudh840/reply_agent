/**
 * Diagnostic to assess objection-handling recovery options.
 * Prints, for each agent:
 *   - Current objection_handling shape and entry count
 *   - Count of objection_handling embeddings in knowledge_base_embeddings
 *   - Any recoverable objection/response pairs from embedding content_text
 *
 * Run: LIVE_TESTS=1 npx vitest run lib/openai/__tests__/objection-recovery.test.ts
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

describe.skipIf(!LIVE)('objection recovery diagnostic', () => {
  it('reports current vs. recoverable objection state per agent', async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: agents, error: aErr } = await supabase
      .from('agents')
      .select('id, name, objection_handling, updated_at')
      .eq('is_active', true);
    if (aErr) throw aErr;

    console.log('\n=== OBJECTION HANDLING STATE (live) ===\n');

    for (const agent of agents || []) {
      const a = agent as any;
      const oh = a.objection_handling || {};

      const { data: embs, error: eErr } = await supabase
        .from('knowledge_base_embeddings')
        .select('content_text, created_at')
        .eq('agent_id', a.id)
        .eq('content_type', 'objection_handling')
        .order('created_at', { ascending: false });
      if (eErr) throw eErr;

      console.log(`\n=== ${a.name} (${a.id}) — updated_at=${a.updated_at} ===`);
      if (Array.isArray(oh.common_objections)) {
        console.log(`  current (new format): ${oh.common_objections.length} entries`);
        oh.common_objections.forEach((e: any, i: number) => {
          const o = (e.objection || '').slice(0, 80);
          const r = (e.response || '').slice(0, 80);
          console.log(`    ${i + 1}. OBJ: "${o}"`);
          console.log(`       RES: "${r}"`);
        });
      } else if (typeof oh === 'object') {
        const legacyKeys = Object.keys(oh).filter((k) => k !== 'common_objections');
        console.log(`  current (legacy): ${legacyKeys.length} entries`);
        legacyKeys.forEach((k, i) => {
          const v = (oh as any)[k];
          console.log(`    ${i + 1}. OBJ: "${k.slice(0, 80)}"`);
          console.log(`       RES: "${String(v).slice(0, 80)}"`);
        });
      }
      console.log(`  embeddings (${embs?.length ?? 0}):`);
      for (const e of embs || []) {
        const preview = ((e as any).content_text || '').slice(0, 240).replace(/\n/g, ' | ');
        console.log(`    [${(e as any).created_at}] ${preview}`);
      }
    }
  }, 120000);
});
