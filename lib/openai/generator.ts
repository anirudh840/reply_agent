import { createOpenAIClient } from './client';
import { getFormattedContext } from '../rag/retrieval';
import type { GeneratedResponse, Agent, InterestedLead, ConversationMessage } from '../types';

const RESPONSE_GENERATION_SYSTEM_PROMPT = `You are an expert sales development representative writing personalized email responses for cold outreach campaigns.

Your role is to:
1. Craft professional, engaging email responses
2. Use the provided knowledge base to answer questions accurately
3. Match the tone and context of the conversation
4. Move the conversation forward towards a meeting/call
5. Be concise but helpful (aim for 100-200 words)

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
  "reasoning": "Brief explanation of why you chose this response and your confidence level"
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
