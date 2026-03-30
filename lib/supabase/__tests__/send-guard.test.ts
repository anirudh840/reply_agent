import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Supabase client before importing the module under test
const mockRpc = vi.fn();
const mockUpdate = vi.fn();
const mockEq = vi.fn();

vi.mock('../client', () => ({
  supabaseAdmin: new Proxy({}, {
    get(_target, prop) {
      if (prop === 'rpc') return mockRpc;
      if (prop === 'from') return () => ({
        update: (...args: any[]) => {
          mockUpdate(...args);
          return { eq: (...eqArgs: any[]) => mockEq(...eqArgs) };
        },
      });
      return undefined;
    },
  }),
}));

import { acquireSendLock, markSendComplete, markSendFailed } from '../send-guard';

describe('send-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('acquireSendLock', () => {
    const baseParams = {
      agentId: 'agent-123',
      leadId: 'lead-456',
      leadEmail: 'test@example.com',
      idempotencyKey: 'reply-to:reply-789',
      sendSource: 'webhook' as const,
      messageContent: 'Hello!',
    };

    it('returns acquired=true when the PG function returns a UUID', async () => {
      mockRpc.mockResolvedValue({ data: 'send-log-uuid-001', error: null });

      const result = await acquireSendLock(baseParams);

      expect(result.acquired).toBe(true);
      expect(result.sendLogId).toBe('send-log-uuid-001');
      expect(mockRpc).toHaveBeenCalledWith('acquire_send_lock', {
        p_agent_id: 'agent-123',
        p_lead_id: 'lead-456',
        p_lead_email: 'test@example.com',
        p_idempotency_key: 'reply-to:reply-789',
        p_send_source: 'webhook',
        p_message_content: 'Hello!',
      });
    });

    it('returns acquired=false when the PG function returns null (duplicate)', async () => {
      mockRpc.mockResolvedValue({ data: null, error: null });

      const result = await acquireSendLock(baseParams);

      expect(result.acquired).toBe(false);
      expect(result.sendLogId).toBeUndefined();
    });

    it('returns acquired=false on database error (fail closed)', async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'connection refused' },
      });

      const result = await acquireSendLock(baseParams);

      expect(result.acquired).toBe(false);
    });

    it('passes null for optional params when not provided', async () => {
      mockRpc.mockResolvedValue({ data: 'uuid', error: null });

      await acquireSendLock({
        agentId: 'agent-1',
        leadEmail: 'test@test.com',
        idempotencyKey: 'key',
        sendSource: 'cron',
      });

      expect(mockRpc).toHaveBeenCalledWith('acquire_send_lock', {
        p_agent_id: 'agent-1',
        p_lead_id: null,
        p_lead_email: 'test@test.com',
        p_idempotency_key: 'key',
        p_send_source: 'cron',
        p_message_content: null,
      });
    });

    it('same idempotency key for webhook and cron ensures only one acquires', async () => {
      mockRpc.mockResolvedValueOnce({ data: 'uuid-1', error: null });
      mockRpc.mockResolvedValueOnce({ data: null, error: null });

      const webhookResult = await acquireSendLock({
        ...baseParams,
        sendSource: 'webhook',
      });
      const cronResult = await acquireSendLock({
        ...baseParams,
        sendSource: 'cron',
      });

      expect(webhookResult.acquired).toBe(true);
      expect(cronResult.acquired).toBe(false);
    });

    it('different idempotency keys both acquire successfully', async () => {
      mockRpc.mockResolvedValueOnce({ data: 'uuid-1', error: null });
      mockRpc.mockResolvedValueOnce({ data: 'uuid-2', error: null });

      const result1 = await acquireSendLock({
        ...baseParams,
        idempotencyKey: 'reply-to:reply-1',
      });
      const result2 = await acquireSendLock({
        ...baseParams,
        idempotencyKey: 'reply-to:reply-2',
      });

      expect(result1.acquired).toBe(true);
      expect(result2.acquired).toBe(true);
    });
  });

  describe('markSendComplete', () => {
    it('updates send_log with sent status and message ID', async () => {
      mockEq.mockResolvedValue({ error: null });

      await markSendComplete('log-id-1', 'platform-msg-123');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'sent',
        platform_message_id: 'platform-msg-123',
        sent_at: expect.any(String),
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'log-id-1');
    });

    it('handles missing platform message ID', async () => {
      mockEq.mockResolvedValue({ error: null });

      await markSendComplete('log-id-1');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'sent',
        platform_message_id: null,
        sent_at: expect.any(String),
      });
    });
  });

  describe('markSendFailed', () => {
    it('updates send_log with failed status and error message', async () => {
      mockEq.mockResolvedValue({ error: null });

      await markSendFailed('log-id-1', 'Connection timeout');

      expect(mockUpdate).toHaveBeenCalledWith({
        status: 'failed',
        error_message: 'Connection timeout',
      });
      expect(mockEq).toHaveBeenCalledWith('id', 'log-id-1');
    });

    it('does not throw on DB error', async () => {
      mockEq.mockResolvedValue({ error: { message: 'DB error' } });

      await markSendFailed('log-id-1', 'some error');
    });
  });
});
