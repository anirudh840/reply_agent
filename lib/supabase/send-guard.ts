import { supabaseAdmin } from './client';

export type SendSource = 'webhook' | 'cron' | 'followup' | 'approve' | 'manual' | 'legacy_approve';

interface AcquireSendLockParams {
  agentId: string;
  leadId?: string;
  leadEmail: string;
  idempotencyKey: string;
  sendSource: SendSource;
  messageContent?: string;
}

interface SendLockResult {
  acquired: boolean;
  sendLogId?: string;
}

/**
 * Atomically acquire a send lock. Returns { acquired: true, sendLogId } if this
 * is the first caller for the given (agentId, idempotencyKey). Returns
 * { acquired: false } if another process already claimed it.
 *
 * Uses a PostgreSQL function with INSERT ... ON CONFLICT DO NOTHING RETURNING.
 */
export async function acquireSendLock(params: AcquireSendLockParams): Promise<SendLockResult> {
  // @ts-ignore - send_log table and acquire_send_lock function not in generated Supabase types
  const { data, error } = await supabaseAdmin.rpc('acquire_send_lock', {
    p_agent_id: params.agentId,
    p_lead_id: params.leadId || null,
    p_lead_email: params.leadEmail,
    p_idempotency_key: params.idempotencyKey,
    p_send_source: params.sendSource,
    p_message_content: params.messageContent || null,
  });

  if (error) {
    console.error('[SendGuard] Failed to acquire send lock:', error);
    // Fail closed — if we can't check, don't send
    return { acquired: false };
  }

  // The PG function returns UUID if acquired, null if duplicate
  if (data) {
    return { acquired: true, sendLogId: data as string };
  }
  return { acquired: false };
}

/**
 * Mark a send as successfully completed.
 */
export async function markSendComplete(sendLogId: string, platformMessageId?: string): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from('send_log')
    .update({
      status: 'sent',
      platform_message_id: platformMessageId || null,
      sent_at: new Date().toISOString(),
    })
    .eq('id', sendLogId);

  if (error) {
    console.error('[SendGuard] Failed to mark send complete:', error);
  }
}

/**
 * Mark a send as failed.
 */
export async function markSendFailed(sendLogId: string, errorMessage: string): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from('send_log')
    .update({
      status: 'failed',
      error_message: errorMessage,
    })
    .eq('id', sendLogId);

  if (error) {
    console.error('[SendGuard] Failed to mark send failed:', error);
  }
}
