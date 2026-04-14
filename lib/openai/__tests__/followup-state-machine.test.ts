/**
 * Followup state-machine trace test.
 *
 * Pulls the real RGL Campaigns agent's followup sequence from the DB, then
 * simulates the full lifecycle (initial reply → approve → stage 1 held →
 * approve → stage 2 held → ... → final) using the exact semantics implemented
 * by app/api/followups/schedule, app/api/leads/approve-and-send, and
 * app/api/webhooks/[webhook_id]. Verifies each stage fires exactly once and
 * the lead reaches `completed` without duplicates or infinite loops.
 *
 * Run: npx vitest run lib/openai/__tests__/followup-state-machine.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { addDays } from 'date-fns';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

type LeadState = {
  followup_stage: number;
  next_followup_due_at: string | null;
  needs_approval: boolean;
  last_response_generated: string | null;
  last_response_sent: string | null;
  last_response_sent_at: string | null;
  conversation_status: 'active' | 'completed' | 'paused' | 'unresponsive';
};

type Step = { delay_days: number; type: string; custom_instructions?: string };

/**
 * Mirror of the held-followup branch in followups/schedule/route.ts after Fix 1.
 */
function cronHoldFollowup(lead: LeadState, nextStage: number, content: string): LeadState {
  return {
    ...lead,
    followup_stage: nextStage,
    next_followup_due_at: null,
    needs_approval: true,
    last_response_generated: content,
  };
}

/**
 * Mirror of cron auto-send branch (unchanged: uses steps[nextStage] for next delay).
 */
function cronAutoSend(lead: LeadState, nextStage: number, steps: Step[], content: string, now: Date): LeadState {
  const nextFollowupDate =
    nextStage < steps.length ? addDays(now, steps[nextStage].delay_days) : null;
  return {
    ...lead,
    followup_stage: nextStage,
    next_followup_due_at: nextFollowupDate?.toISOString() ?? null,
    needs_approval: false,
    last_response_sent: content,
    last_response_sent_at: now.toISOString(),
    conversation_status: nextStage >= steps.length ? 'completed' : 'active',
  };
}

/**
 * Mirror of approve-and-send / send-message after Fix 2.
 */
function approveAndSend(lead: LeadState, steps: Step[], content: string, now: Date): LeadState {
  const nextFollowupConfig = steps[lead.followup_stage];
  const isFinalStage = !nextFollowupConfig;
  const nextFollowupDate = nextFollowupConfig
    ? addDays(now, nextFollowupConfig.delay_days).toISOString()
    : null;
  return {
    ...lead,
    last_response_sent: content,
    last_response_sent_at: now.toISOString(),
    needs_approval: false,
    next_followup_due_at: nextFollowupDate,
    conversation_status: isFinalStage ? 'completed' : 'active',
  };
}

/**
 * Mirror of cron sequence-exhaustion branch after Fix 1.
 */
function cronExhaust(lead: LeadState): LeadState {
  return { ...lead, conversation_status: 'completed', next_followup_due_at: null };
}

function cronPicksLead(lead: LeadState, now: Date): boolean {
  if (lead.conversation_status !== 'active') return false;
  if (!lead.next_followup_due_at) return false;
  return new Date(lead.next_followup_due_at).getTime() <= now.getTime();
}

// Guard: pulls the RGL agent config from live Supabase. Only runs when LIVE_TESTS=1.
const LIVE = process.env.LIVE_TESTS === '1';

describe.skipIf(!LIVE)('followup state machine (RGL-style human_in_loop)', () => {
  let steps: Step[];
  let agentName: string;

  beforeAll(async () => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data, error } = await supabase
      .from('agents')
      .select('name, followup_sequence')
      .ilike('name', '%RGL campaigns%')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('RGL campaigns agent not found');
    const seq = (data as any).followup_sequence;
    steps = seq?.steps || [];
    agentName = (data as any).name;
    console.log(`[setup] agent="${agentName}" steps=${steps.length}`);
    console.log(`[setup] delays(days)=${steps.map((s) => s.delay_days).join(', ')}`);
    expect(steps.length).toBeGreaterThan(0);
  }, 30000);

  it('full human_in_loop lifecycle: each stage fires exactly once, lead ends completed', () => {
    let lead: LeadState = {
      followup_stage: 0,
      next_followup_due_at: null,
      needs_approval: true, // initial response held by webhook
      last_response_generated: 'INITIAL_HELD',
      last_response_sent: null,
      last_response_sent_at: null,
      conversation_status: 'active',
    };

    const transitions: string[] = [];
    let now = new Date('2026-04-01T00:00:00Z');

    // 1. Human approves the initial response
    lead = approveAndSend(lead, steps, 'INITIAL_SENT', now);
    transitions.push(
      `approve initial: stage=${lead.followup_stage} next_due=${lead.next_followup_due_at} status=${lead.conversation_status}`
    );
    expect(lead.conversation_status).toBe('active');
    expect(lead.next_followup_due_at).not.toBeNull();

    // 2+. Simulate each followup stage
    for (let iter = 0; iter < steps.length + 2; iter++) {
      // advance clock to the due date
      if (lead.next_followup_due_at) {
        now = new Date(lead.next_followup_due_at);
      }
      const picked = cronPicksLead(lead, now);
      if (!picked) {
        transitions.push(`[iter ${iter}] cron skipped (status=${lead.conversation_status}, due=${lead.next_followup_due_at})`);
        break;
      }
      const nextStage = lead.followup_stage + 1;

      // Exhaustion check
      if (nextStage > steps.length) {
        lead = cronExhaust(lead);
        transitions.push(`[iter ${iter}] exhausted → completed`);
        break;
      }

      // Held (human_in_loop)
      lead = cronHoldFollowup(lead, nextStage, `FOLLOWUP_${nextStage}_HELD`);
      transitions.push(
        `[iter ${iter}] cron held stage ${nextStage}: followup_stage=${lead.followup_stage} due=null`
      );
      expect(lead.needs_approval).toBe(true);
      expect(cronPicksLead(lead, now)).toBe(false); // parked

      // Human approves
      lead = approveAndSend(lead, steps, `FOLLOWUP_${nextStage}_SENT`, now);
      transitions.push(
        `[iter ${iter}] approve stage ${nextStage}: next_due=${lead.next_followup_due_at} status=${lead.conversation_status}`
      );

      if (lead.conversation_status === 'completed') break;
      expect(lead.next_followup_due_at).not.toBeNull();
    }

    console.log('\n'.concat(transitions.join('\n')));

    expect(lead.conversation_status).toBe('completed');
    expect(lead.followup_stage).toBe(steps.length);
    expect(lead.next_followup_due_at).toBeNull();
  });

  it('lead parked by pre-fix bug (next_followup_due_at=null) can still be approved and resume', () => {
    // Simulate a lead in the "stuck" state that the backfill query found
    let lead: LeadState = {
      followup_stage: 1, // cron advanced this at hold time under Fix 1
      next_followup_due_at: null, // cleared at hold time
      needs_approval: true,
      last_response_generated: 'STUCK_FOLLOWUP_1',
      last_response_sent: 'INITIAL_SENT',
      last_response_sent_at: new Date('2026-03-01T00:00:00Z').toISOString(),
      conversation_status: 'active',
    };

    // User opens inbox, approves. approve-and-send reads followup_stage=1
    // and schedules steps[1] (the next stage after the one being sent).
    const now = new Date('2026-04-01T00:00:00Z');
    lead = approveAndSend(lead, steps, 'FOLLOWUP_1_SENT', now);
    expect(lead.needs_approval).toBe(false);
    expect(lead.conversation_status).toBe('active');
    if (steps.length > 1) {
      expect(lead.next_followup_due_at).not.toBeNull();
      const due = new Date(lead.next_followup_due_at!);
      const expectedDue = addDays(now, steps[1].delay_days);
      expect(Math.abs(due.getTime() - expectedDue.getTime())).toBeLessThan(1000);
    }
  });

  it('fully_automated flow also works under new semantics', () => {
    let lead: LeadState = {
      followup_stage: 0,
      next_followup_due_at: addDays(new Date('2026-04-01T00:00:00Z'), steps[0].delay_days).toISOString(),
      needs_approval: false,
      last_response_generated: null,
      last_response_sent: 'INITIAL_SENT',
      last_response_sent_at: new Date('2026-04-01T00:00:00Z').toISOString(),
      conversation_status: 'active',
    };

    const sentStages: number[] = [];
    let now = new Date('2026-04-01T00:00:00Z');

    for (let iter = 0; iter < steps.length + 2; iter++) {
      if (lead.next_followup_due_at) now = new Date(lead.next_followup_due_at);
      if (!cronPicksLead(lead, now)) break;
      const nextStage = lead.followup_stage + 1;
      if (nextStage > steps.length) {
        lead = cronExhaust(lead);
        break;
      }
      lead = cronAutoSend(lead, nextStage, steps, `AUTO_FOLLOWUP_${nextStage}`, now);
      sentStages.push(nextStage);
      if (lead.conversation_status === 'completed') break;
    }

    // Each followup stage should fire exactly once
    expect(sentStages).toEqual(Array.from({ length: steps.length }, (_, i) => i + 1));
    expect(lead.conversation_status).toBe('completed');
    console.log(`[auto] sent stages: ${sentStages.join(', ')}`);
  });
});
