/**
 * Check every agent's AI provider + model ID to find who's using the broken
 * Anthropic model string that's 404ing.
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

describe.skipIf(!LIVE)('agent models', () => {
  it('dump provider + model for every agent', async () => {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await supabase
      .from('agents')
      .select('id, name, is_active, ai_provider, ai_model, anthropic_api_key, openai_api_key')
      .eq('is_active', true);
    console.log('\n=== ACTIVE AGENT AI CONFIG ===');
    for (const a of data || []) {
      const A = a as any;
      console.log(`${A.name}: provider=${A.ai_provider || 'default(openai)'} model=${A.ai_model || 'default'} has_anthropic_key=${!!A.anthropic_api_key} has_openai_key=${!!A.openai_api_key}`);
    }
  }, 60000);
});
