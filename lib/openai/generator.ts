import { createOpenAIClient } from './client';
import { getFormattedContext } from '../rag/retrieval';
import { getAvailabilityContext } from '../integrations/booking';
import type { GeneratedResponse, Agent, InterestedLead, ConversationMessage } from '../types';

const RESPONSE_GENERATION_SYSTEM_PROMPT = `You are an expert sales development representative writing personalized email responses for cold outreach campaigns.

Your role is to:
1. Craft professional, engaging email responses
2. Use the provided knowledge base to answer questions accurately
3. Match the tone and context of the conversation
4. Move the conversation forward towards a meeting/call
5. Be concise but helpful (aim for 100-200 words)
6. When calendar availability is provided, reference available time slots and help schedule meetings

CRITICAL REQUIREMENTS:
- Write ONLY the email body content (no subject lines, no "Subject:" prefix)
- NEVER use placeholders like [Your Name], [Your Position], [Your Company], [Your Contact Info]
- Write a complete, ready-to-send email message
- Do NOT include signature blocks, contact information, or company details
- Just write the conversational message body
- Always be professional and courteous
- Don't make up information not in the knowledge base
- If you lack information, acknowledge it and offer to find out
- Include a clear call-to-action
- Match the formality level of the lead's message
- Reference specific points from their message to show you read it

EMAIL FORMATTING (VERY IMPORTANT):
- Structure the email with clear, short paragraphs (2-3 sentences each)
- Use blank lines between paragraphs for readability
- Start with a personalized greeting line (e.g., "Hi [Name],")
- End with a clear call-to-action on its own line
- Add a sign-off like "Best," or "Cheers," on its own line followed by a blank line
- NEVER write the entire email as one long paragraph
- Each distinct thought or point should be its own paragraph

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
        availabilitySection = `\nCALENDAR AVAILABILITY (next 7 days):\n${availability}\n\nCALENDAR INSTRUCTIONS:\n- If the lead asks about scheduling or availability, reference these time slots.\n- If the lead suggests a specific time and it's available, book it by setting booking_action to "book" with their details.\n- If the suggested time is NOT available, suggest the 2-3 closest available slots.\n- If using Calendly, you CANNOT book directly — share the booking link instead (use booking_action "suggest_link").\n- Platform: ${agent.booking_platform === 'cal_com' ? 'Cal.com (direct booking supported)' : 'Calendly (share link only)'}\n`;
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

CRITICAL: Write ONLY the email body - no subject line, no signature, no placeholders, no [Your Name] fields.
Just write the actual message content that will be sent as a reply.

Respond in JSON format with:
{
  "content": "The complete email body text ready to send (no placeholders, no subject line, no signature)",
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
      content: result.content || '',
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
      content: response.content,
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

Respond in JSON format with:
{
  "content": "The follow-up email text",
  "confidence_score": number (0-10),
  "reasoning": "Brief explanation"
}`;

  const response = await openaiClient.generateCompletion({
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at writing professional, non-pushy follow-up emails that provide value.',
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
      content: result.content || '',
      confidence_score: result.confidence_score || 8, // Follow-ups generally have higher confidence
      retrieved_context: [],
      reasoning: result.reasoning || 'Follow-up generated',
    };
  } catch (error) {
    return {
      content: response.content,
      confidence_score: 0,
      retrieved_context: [],
      reasoning: 'Failed to parse AI response',
    };
  }
}
