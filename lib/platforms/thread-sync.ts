import { createClientForAgent } from './index';
import { EmailBisonClient } from './emailbison';
import { parseEmailThread } from '../utils/email-parser';
import type { ConversationMessage, Agent, InterestedLead } from '../types';

/**
 * Refresh the conversation thread by fetching the latest data from the
 * platform API. Merges API-fetched lead messages with existing agent
 * messages in the thread to produce a complete, chronological view.
 *
 * Call this after sending a reply so the inbox shows the actual sent email
 * alongside the full conversation.
 */
export async function refreshConversationThread(params: {
  lead: InterestedLead;
  agent: Agent;
  /** Freshly sent agent message to ensure it's in the thread even if the API hasn't indexed it yet */
  sentMessage?: {
    content: string;
    timestamp: string;
    message_id?: string;
  };
}): Promise<ConversationMessage[]> {
  const { lead, agent, sentMessage } = params;
  const platform = agent.platform || 'emailbison';

  // Get lead_id from metadata for API lookup
  const leadId = lead.lead_metadata?.id?.toString();

  if (!leadId || platform !== 'emailbison') {
    // Can't fetch from API — return existing thread with sent message appended
    if (sentMessage) {
      return [
        ...lead.conversation_thread,
        {
          role: 'agent',
          content: sentMessage.content,
          timestamp: sentMessage.timestamp,
          emailbison_message_id: sentMessage.message_id,
        },
      ];
    }
    return lead.conversation_thread;
  }

  try {
    const client = createClientForAgent(agent);
    if (!(client instanceof EmailBisonClient)) {
      throw new Error('Expected EmailBisonClient');
    }

    const apiReplies = await client.getRepliesByLeadId(leadId);

    if (apiReplies.length === 0) {
      // API returned nothing — keep existing thread
      if (sentMessage) {
        return [
          ...lead.conversation_thread,
          {
            role: 'agent',
            content: sentMessage.content,
            timestamp: sentMessage.timestamp,
            emailbison_message_id: sentMessage.message_id,
          },
        ];
      }
      return lead.conversation_thread;
    }

    // Sort chronologically (oldest first)
    const sorted = [...apiReplies].sort(
      (a, b) =>
        new Date(a.received_at).getTime() -
        new Date(b.received_at).getTime()
    );

    // Build new thread from API data
    const newThread: ConversationMessage[] = [];

    for (const apiReply of sorted) {
      const parsed = parseEmailThread(apiReply.body);
      const content = parsed.length > 0 ? parsed[0].content : apiReply.body;

      newThread.push({
        role: 'lead',
        content,
        timestamp: apiReply.received_at,
        emailbison_message_id: apiReply.id,
        from: apiReply.from_name || apiReply.from_email,
      });
    }

    // Merge in existing agent messages from the thread (API only has lead replies)
    const existingAgentMessages = lead.conversation_thread.filter(
      (m) => m.role === 'agent' && !m.is_quoted
    );
    for (const agentMsg of existingAgentMessages) {
      const alreadyExists = newThread.some(
        (m) =>
          m.role === 'agent' &&
          m.emailbison_message_id === agentMsg.emailbison_message_id
      );
      if (!alreadyExists) {
        newThread.push(agentMsg);
      }
    }

    // Add the freshly sent message if not already in the thread
    if (sentMessage) {
      const alreadyExists = sentMessage.message_id
        ? newThread.some(
            (m) =>
              m.role === 'agent' &&
              m.emailbison_message_id === sentMessage.message_id
          )
        : false;

      if (!alreadyExists) {
        newThread.push({
          role: 'agent',
          content: sentMessage.content,
          timestamp: sentMessage.timestamp,
          emailbison_message_id: sentMessage.message_id,
        });
      }
    }

    // Sort the merged thread chronologically
    newThread.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    console.log(
      `[ThreadSync] Refreshed thread for ${lead.lead_email}: ` +
        `${apiReplies.length} API replies, ` +
        `${existingAgentMessages.length} existing agent msgs, ` +
        `${newThread.length} total messages`
    );

    return newThread;
  } catch (error) {
    console.warn(
      `[ThreadSync] Failed to refresh thread for ${lead.lead_email}:`,
      error
    );

    // Fallback: keep existing thread with sent message
    if (sentMessage) {
      return [
        ...lead.conversation_thread,
        {
          role: 'agent',
          content: sentMessage.content,
          timestamp: sentMessage.timestamp,
          emailbison_message_id: sentMessage.message_id,
        },
      ];
    }
    return lead.conversation_thread;
  }
}
