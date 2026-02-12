import { createOpenAIClient } from './client';
import type { CategorizationResult, Reply } from '../types';
import { REPLY_STATUS } from '../constants';

const CATEGORIZATION_SYSTEM_PROMPT = `You are an expert email categorization assistant for cold email campaigns.

Your job is to analyze email replies and determine:
1. Whether the reply shows genuine interest in the product/service
2. The correct status category for the reply
3. Your confidence in the categorization

IMPORTANT GUIDELINES:
- "Interested" means the person wants to learn more, schedule a call, or engage further
- Simple acknowledgments ("Thanks", "Got it") are NOT interested unless they ask questions
- Out of office/automated replies should be marked as automated_reply
- Unsubscribe requests should be marked as unsubscribed
- Polite rejections ("Not interested", "Remove me") are not_interested
- Vague responses need context to determine interest

Provide your analysis in JSON format.`;

/**
 * Categorize an email reply using AI
 */
export async function categorizeReply(params: {
  reply: Reply | { reply_body: string; reply_subject?: string; original_status: string };
  openaiApiKey: string;
}): Promise<CategorizationResult> {
  const { reply, openaiApiKey } = params;
  const openaiClient = createOpenAIClient(openaiApiKey);

  const userPrompt = `Analyze this email reply from a cold outreach campaign:

SUBJECT: ${reply.reply_subject || 'No subject'}

BODY:
${reply.reply_body}

ORIGINAL STATUS: ${reply.original_status}

Determine if this is a genuinely interested lead or a false positive.

Respond in JSON format with:
{
  "is_truly_interested": boolean,
  "corrected_status": "interested" | "not_interested" | "automated_reply" | "out_of_office" | "unsubscribed" | "other",
  "confidence_score": number (0-10),
  "reasoning": "Brief explanation of your categorization"
}`;

  const response = await openaiClient.generateCompletion({
    messages: [
      { role: 'system', content: CATEGORIZATION_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  });

  try {
    const result = JSON.parse(response.content);

    return {
      is_truly_interested: result.is_truly_interested || false,
      corrected_status: result.corrected_status || REPLY_STATUS.OTHER,
      confidence_score: result.confidence_score || 5,
      reasoning: result.reasoning || 'No reasoning provided',
    };
  } catch (error) {
    // Fallback if JSON parsing fails
    return {
      is_truly_interested: false,
      corrected_status: REPLY_STATUS.OTHER,
      confidence_score: 0,
      reasoning: 'Failed to parse AI response',
    };
  }
}

/**
 * Batch categorize multiple replies
 */
export async function categorizeReplies(params: {
  replies: Reply[];
  openaiApiKey: string;
}): Promise<Map<string, CategorizationResult>> {
  const { replies, openaiApiKey } = params;
  const results = new Map<string, CategorizationResult>();

  // Process in sequence to avoid rate limits (can be parallelized with proper rate limiting)
  for (const reply of replies) {
    try {
      const result = await categorizeReply({ reply, openaiApiKey });
      results.set(reply.id, result);
    } catch (error) {
      console.error(`Failed to categorize reply ${reply.id}:`, error);
      // Set a default result for failed categorizations
      results.set(reply.id, {
        is_truly_interested: false,
        corrected_status: REPLY_STATUS.OTHER,
        confidence_score: 0,
        reasoning: 'Categorization failed',
      });
    }
  }

  return results;
}
