import { createOpenAIClient } from './client';
import { getFormattedContext } from '../rag/retrieval';
import { getAvailabilityContext } from '../integrations/booking';
import type { GeneratedResponse, Agent, InterestedLead, ConversationMessage } from '../types';

/**
 * Sanitize AI-generated email content to remove:
 * - Subject lines (e.g., "Subject: ...")
 * - Placeholder brackets (e.g., [Your Name], [Company])
 * - Signature blocks with placeholders
 */
function sanitizeEmailContent(content: string): string {
  let cleaned = content;

  // Remove subject lines at the beginning
  cleaned = cleaned.replace(/^(Subject|Re|Fwd|RE|FW):.*\n*/im, '');

  // Remove placeholder brackets like [Your Name], [Your Company], etc.
  cleaned = cleaned.replace(/\[Your\s+\w+(\s+\w+)?\]/gi, '');
  cleaned = cleaned.replace(/\[Company\s*\w*\]/gi, '');
  cleaned = cleaned.replace(/\[Name\]/gi, '');
  cleaned = cleaned.replace(/\[Position\]/gi, '');
  cleaned = cleaned.replace(/\[Phone\s*\w*\]/gi, '');
  cleaned = cleaned.replace(/\[Email\s*\w*\]/gi, '');
  cleaned = cleaned.replace(/\[Website\s*\w*\]/gi, '');
  cleaned = cleaned.replace(/\[Contact\s*\w*\]/gi, '');
  cleaned = cleaned.replace(/\[Insert\s+\w+.*?\]/gi, '');

  // Remove lines that are ONLY a placeholder (empty after removal)
  cleaned = cleaned.replace(/^\s*\n/gm, '\n');

  // Collapse 3+ consecutive newlines into 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}

const RESPONSE_GENERATION_SYSTEM_PROMPT = `You are an expert sales development representative writing personalized email responses for cold outreach campaigns.

Your role is to:
1. Craft professional, engaging email responses
2. Use the provided knowledge base to answer questions accurately
3. Match the tone and context of the conversation
4. Move the conversation forward towards a meeting/call
5. Be concise but helpful (aim for 100-200 words)
6. When calendar availability is provided, reference available time slots and help schedule meetings

ABSOLUTE RULES (VIOLATIONS WILL CAUSE FAILURE):
1. NEVER include a subject line. No "Subject:", no "Re:", no title — the email is a reply in an existing thread.
2. NEVER use placeholder brackets. Text like [Your Name], [Your Company], [Your Position], [Your Phone], [Your Website], [Company], [Name], [Contact Info] is STRICTLY FORBIDDEN. If you don't know a value, OMIT IT ENTIRELY — do not put a bracket placeholder.
3. NEVER include a signature block. No name/title/company/phone/website at the end. End with just a short sign-off like "Best," or "Cheers," and NOTHING after it.
4. Write ONLY the message body — the exact text that goes into the email reply field.
5. Don't make up information not in the knowledge base.
6. If you lack information, acknowledge it and offer to find out.
7. Include a clear call-to-action.
8. Match the formality level of the lead's message.
9. Reference specific points from their message to show you read it.

EMAIL FORMATTING:
- Structure the email with clear, short paragraphs (2-3 sentences each)
- Use blank lines between paragraphs for readability
- Start with a personalized greeting (e.g., "Hi Sarah,")
- End with a clear call-to-action on its own line
- Add a sign-off like "Best," or "Cheers," on its own line — NOTHING after it
- NEVER write the entire email as one long paragraph

Provide your response in JSON format with the email content and a confidence score.`;

/**
 * Generate an email response for an interested lead
 */
export async function generateResponse(params: {
  leadEmail: string;
  leadName?: string;
  leadMessage: string;
  agent: Agent;
  conversationHistory?: ConversationMessage[];
}): Promise<GeneratedResponse> {
  const { leadEmail, leadName, leadMessage, agent, conversationHistory = [] } = params;

  // Validate lead message is not empty
  if (!leadMessage || leadMessage.trim() === '') {
    throw new Error('Lead message cannot be empty');
  }

  const openaiClient = createOpenAIClient(agent.openai_api_key);

  // Retrieve relevant context from knowledge base
  const { results, formattedContext } = await getFormattedContext({
    query: leadMessage,
    agentId: agent.id,
    openaiApiKey: agent.openai_api_key,
  });

  // Build conversation history string
  const historyString =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-5) // Last 5 messages for context
          .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
          .join('\n\n')
      : 'No previous conversation';

  // Fetch calendar availability if booking is configured
  let availabilitySection = '';
  const hasBooking = agent.booking_platform && agent.booking_api_key && agent.booking_event_id;
  if (hasBooking) {
    try {
      const availability = await getAvailabilityContext(agent);
      if (availability) {
        availabilitySection = `\nCALENDAR AVAILABILITY (next 7 days):\n${availability}\n\nCALENDAR INSTRUCTIONS:\n- If the lead asks about scheduling or availability, reference these time slots.\n- If the lead suggests a specific time and it's available, book it by setting booking_action to "book" with their details.\n- If the suggested time is NOT available, suggest the 2-3 closest available slots.\n- Both Cal.com and Calendly support direct booking — set booking_action to "book" when the lead requests a specific time.\n- Platform: ${agent.booking_platform === 'cal_com' ? 'Cal.com' : 'Calendly'}\n`;
      }
    } catch (error) {
      console.warn('[Generator] Failed to fetch availability:', error);
    }
  }

  const bookingJsonSection = hasBooking
    ? `,
  "booking_action": {
    "action": "none" | "book" | "suggest_link",
    "date": "YYYY-MM-DD (if booking)",
    "start_time": "HH:MM (if booking)",
    "timezone": "timezone string (if booking)",
    "attendee_name": "lead name (if booking)",
    "attendee_email": "lead email (if booking)"
  }`
    : '';

  const userPrompt = `Generate a response for this email from a cold outreach lead:

LEAD INFORMATION:
- Name: ${leadName || 'Unknown'}
- Email: ${leadEmail}

THEIR LATEST MESSAGE:
${leadMessage}

CONVERSATION HISTORY:
${historyString}

RELEVANT KNOWLEDGE BASE CONTEXT:
${formattedContext}

COMPANY/PRODUCT INFO:
${agent.knowledge_base.product_description || 'No product description available'}

INSTRUCTIONS:
${agent.knowledge_base.custom_instructions || 'Respond professionally and helpfully'}
${availabilitySection}
Generate an appropriate email response that:
1. Addresses their questions/concerns
2. Uses information from the knowledge base
3. Includes a clear next step or call-to-action
4. Maintains a professional yet friendly tone

CRITICAL RULES:
- This is a REPLY in an existing email thread. Do NOT include any subject line.
- Do NOT use ANY placeholder brackets like [Your Name], [Company], etc. If you don't know it, leave it out entirely.
- Do NOT add a signature block (no name, title, company, phone, website at the end).
- End with just a sign-off like "Best," or "Cheers," and STOP.

Respond in JSON format with:
{
  "content": "The email reply body only (NO subject, NO placeholders, NO signature block)",
  "confidence_score": number (0-10, where 10 is highest confidence),
  "reasoning": "Brief explanation of why you chose this response and your confidence level"${bookingJsonSection}
}`;

  const response = await openaiClient.generateCompletion({
    messages: [
      { role: 'system', content: RESPONSE_GENERATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 1000,
    response_format: { type: 'json_object' },
  });

  try {
    const result = JSON.parse(response.content);

    return {
      content: sanitizeEmailContent(result.content || ''),
      confidence_score: result.confidence_score || 5,
      retrieved_context: results.map((r) => r.content_text),
      reasoning: result.reasoning || 'No reasoning provided',
      booking_action: result.booking_action && result.booking_action.action !== 'none'
        ? result.booking_action
        : undefined,
    };
  } catch (error) {
    // Fallback if JSON parsing fails
    return {
      content: sanitizeEmailContent(response.content),
      confidence_score: 0,
      retrieved_context: [],
      reasoning: 'Failed to parse AI response',
    };
  }
}

/**
 * Generate a follow-up email
 */
export async function generateFollowup(params: {
  lead: InterestedLead;
  agent: Agent;
  followupStage: number;
}): Promise<GeneratedResponse> {
  const { lead, agent, followupStage } = params;

  const openaiClient = createOpenAIClient(agent.openai_api_key);

  // Get followup configuration
  const followupConfig = agent.followup_sequence.steps[followupStage - 1];
  const followupType = followupConfig?.type || 'value_driven';
  const customInstructions = followupConfig?.custom_instructions;

  // Retrieve relevant context
  const lastLeadMessage =
    lead.conversation_thread
      .filter((msg) => msg.role === 'lead')
      .slice(-1)[0]?.content || '';

  const { formattedContext } = await getFormattedContext({
    query: lastLeadMessage || 'general product information',
    agentId: agent.id,
    openaiApiKey: agent.openai_api_key,
    topK: 3,
  });

  // Build conversation history
  const historyString = lead.conversation_thread
    .slice(-6)
    .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
    .join('\n\n');

  const typeInstructions: Record<string, string> = {
    value_driven:
      'Provide additional value or insights related to their interest. Share a relevant case study or tip.',
    close_up:
      'Politely close the conversation. Thank them for their time and leave the door open for future contact.',
    custom: customInstructions || 'Follow up appropriately based on the conversation context.',
  };

  const userPrompt = `Generate a follow-up email for this lead who showed interest but hasn't responded:

LEAD INFORMATION:
- Name: ${lead.lead_name || 'Unknown'}
- Email: ${lead.lead_email}
- Current Follow-up Stage: ${followupStage}
- Follow-up Type: ${followupType}

CONVERSATION HISTORY:
${historyString}

RELEVANT CONTEXT:
${formattedContext}

FOLLOW-UP INSTRUCTIONS:
${typeInstructions[followupType]}

Generate a follow-up email that:
1. References the previous conversation
2. ${followupType === 'close_up' ? 'Gracefully closes the conversation' : 'Provides additional value'}
3. Is brief and non-pushy (80-150 words)
4. ${followupType === 'close_up' ? 'Thanks them and leaves door open' : 'Includes a soft call-to-action'}

CRITICAL RULES:
- This is a REPLY in an existing email thread. Do NOT include any subject line or "Subject:" prefix.
- Do NOT use ANY placeholder brackets like [Your Name], [Your Company], [Your Position], [Your Phone], etc. If you don't know something, leave it out entirely.
- Do NOT add a signature block (no name, title, company, phone, website at the end).
- End with just a short sign-off like "Best," or "Cheers," and STOP.
- Write ONLY the message body.

Respond in JSON format with:
{
  "content": "The follow-up email body only (NO subject, NO placeholders, NO signature block)",
  "confidence_score": number (0-10),
  "reasoning": "Brief explanation"
}`;

  const response = await openaiClient.generateCompletion({
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at writing professional, non-pushy follow-up emails that provide value. ABSOLUTE RULES: 1) NEVER include a subject line — this is a reply in an existing thread. 2) NEVER use placeholder brackets like [Your Name], [Company], [Position], [Phone], [Website]. If you don\'t know a value, omit it entirely. 3) NEVER include a signature block. End with just a sign-off like "Best," and STOP. Write ONLY the message body.',
      },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 800,
    response_format: { type: 'json_object' },
  });

  try {
    const result = JSON.parse(response.content);

    return {
      content: sanitizeEmailContent(result.content || ''),
      confidence_score: result.confidence_score || 8, // Follow-ups generally have higher confidence
      retrieved_context: [],
      reasoning: result.reasoning || 'Follow-up generated',
    };
  } catch (error) {
    return {
      content: sanitizeEmailContent(response.content),
      confidence_score: 0,
      retrieved_context: [],
      reasoning: 'Failed to parse AI response',
    };
  }
}
