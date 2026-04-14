import { createCompletionClientFromKey } from '../ai/client';
import type { CategorizationResult, Reply } from '../types';
import { REPLY_STATUS } from '../constants';

const CATEGORIZATION_SYSTEM_PROMPT = `You are an expert email categorization assistant for cold email campaigns.

Your job is to analyze email replies and determine:
1. Whether the reply shows genuine interest in the product/service
2. The correct status category for the reply
3. Your confidence in the categorization

CRITICAL RULES — FOLLOW EXACTLY:

MARK AS "interested" (is_truly_interested = true):
- ANY reply that shows curiosity, uncertainty, or engagement — even if vague
- Short curious replies: "What?", "What do you mean?", "Huh?", "Tell me more", "How?", "Explain"
- Acknowledgments that keep the door open: "Ok", "Hmm", "Interesting", "Go on", "Sure"
- Questions of any kind about the product, service, pricing, or process
- Requests for more info, case studies, or proof
- Any mention of scheduling, calls, or meetings
- Replies that ask WHO you are or WHAT the offer is — these are engagement signals
- When in doubt, mark as interested. It's better to respond to a maybe than miss a real lead.

MARK AS "not_interested" ONLY when the reply is an EXPLICIT rejection:
- Clear refusals: "Not interested", "No thanks", "Pass", "Don't contact me"
- Unsubscribe requests: "Remove me", "Unsubscribe", "Stop emailing", "STOP"
- Hostile/negative replies: "Leave me alone", "This is spam"

MARK AS "automated_reply" or "out_of_office":
- Auto-responders, vacation messages, out of office notices
- System-generated replies (delivery failures, bounces)

DO NOT mark short or vague replies as "not_interested". If someone took the time to reply with even "What?" or "Ok", they are engaging — treat them as interested.

UNDERSTANDING CONTEXT FROM QUOTED TEXT:
- The reply body may contain quoted text from the original outbound email (preceded by "On ... wrote:" or "> " markers).
- Use the quoted original email to understand WHAT was asked of the lead.
- If the original email asked the lead to reply with a specific keyword (e.g., "Reply 'PC' if interested", "Say 'POC' for details"), and the lead replied with exactly that keyword, this is a STRONG positive signal — mark as interested with confidence 9-10.
- Short replies like "PC", "POC", "YES", "Sure", "PPC", "NoRetainer" that match a call-to-action keyword in the quoted original email should ALWAYS be categorized as interested.

EXAMPLES (follow these judgments exactly):
- "Well thank you, but who is Angela?" → interested (confidence 8). The lead is asking a question / showing confusion, which is engagement. Any response that clears up the confusion has a real shot at converting.
- "No retainer" followed by "Yes am interested pls share details" → interested (confidence 9). The lead is stating a constraint but explicitly asking for details — a direct interest signal.
- "What if I'm not good at sales? And do you do this for SAAS products?" → interested (confidence 9). Two qualifying questions. Lead is evaluating fit, not rejecting.
- "Who is this?" → interested (confidence 7). Curiosity about the sender is an engagement signal.
- "Not interested, please remove me" → not_interested (confidence 10). Explicit rejection + unsubscribe.

Provide your analysis in JSON format.`;

/**
 * Categorize an email reply using AI
 */
export async function categorizeReply(params: {
  reply: Reply | { reply_body: string; reply_subject?: string; original_status: string };
  openaiApiKey: string;
  aiProvider?: string;
  anthropicApiKey?: string;
  aiModel?: string;
}): Promise<CategorizationResult> {
  const { reply, openaiApiKey, aiProvider, anthropicApiKey, aiModel } = params;
  // Use the configured AI provider for categorization (Anthropic if configured, else OpenAI)
  const provider = aiProvider || 'openai';
  const apiKey = provider === 'anthropic' && anthropicApiKey ? anthropicApiKey : openaiApiKey;
  const aiClient = createCompletionClientFromKey(provider, apiKey, aiModel);

  const userPrompt = `Analyze this email reply from a cold outreach campaign:

SUBJECT: ${reply.reply_subject || 'No subject'}

FULL EMAIL BODY (includes the lead's reply and any quoted original outreach email for context):
${reply.reply_body}

IMPORTANT: The body above may contain quoted text from the original outreach email (after "On ... wrote:" or "> " markers). Use this quoted text to understand what call-to-action was presented to the lead. If the lead replied with a keyword that matches the CTA in the original email, this is a strong interest signal.

Classify this reply using the rules above. You are the source of truth — do not defer to any external classification.

Respond in JSON format with:
{
  "is_truly_interested": boolean,
  "corrected_status": "interested" | "not_interested" | "automated_reply" | "out_of_office" | "unsubscribed" | "other",
  "confidence_score": number (0-10),
  "reasoning": "Brief explanation of your categorization"
}`;

  try {
    const response = await aiClient.generateCompletion({
      messages: [
        { role: 'system', content: CATEGORIZATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(response.content);

    return {
      is_truly_interested: result.is_truly_interested || false,
      corrected_status: result.corrected_status || REPLY_STATUS.OTHER,
      confidence_score: result.confidence_score || 5,
      reasoning: result.reasoning || 'No reasoning provided',
    };
  } catch (error: any) {
    // On ANY failure (AI call timeout, auth error, JSON parse, network error),
    // default to "interested" so the lead surfaces in the inbox for manual review.
    // It's better to review a false positive than silently drop a real lead.
    console.error('[Categorizer] AI categorization failed, defaulting to interested:', error.message || error);
    return {
      is_truly_interested: true,
      corrected_status: REPLY_STATUS.OTHER,
      confidence_score: 0,
      reasoning: `AI categorization failed (${error.message || 'unknown error'}). Defaulting to interested for manual review.`,
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
