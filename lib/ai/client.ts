import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { OPENAI_MODELS } from '../constants';
import { OpenAIError, type EmbeddingResult, type Agent } from '../types';

// Shared interface for chat completions (both OpenAI and Anthropic)
export interface CompletionParams {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_object' | 'text' };
}

export interface CompletionResult {
  content: string;
  finish_reason: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AICompletionClient {
  generateCompletion(params: CompletionParams): Promise<CompletionResult>;
  testConnection(): Promise<boolean>;
}

// =============================================================================
// OpenAI Completion Client
// =============================================================================
class OpenAICompletionClient implements AICompletionClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model || OPENAI_MODELS.GENERATION;
  }

  async generateCompletion(params: CompletionParams): Promise<CompletionResult> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.5,
        max_tokens: params.max_tokens ?? 1000,
        response_format: params.response_format,
      });

      return {
        content: response.choices[0].message.content || '',
        finish_reason: response.choices[0].finish_reason,
        usage: {
          prompt_tokens: response.usage?.prompt_tokens || 0,
          completion_tokens: response.usage?.completion_tokens || 0,
          total_tokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      throw new OpenAIError('Failed to generate completion', error.status, error);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// Anthropic Completion Client
// =============================================================================
class AnthropicCompletionClient implements AICompletionClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model?: string) {
    this.client = new Anthropic({ apiKey });
    // Self-heal known-bad model IDs. "claude-sonnet-4-5-20250514" was stored
    // for some agents (Sonnet 4.5 released on 2025-09-29, not 2025-05-14 —
    // the latter was an Opus 4.0 date, likely a typo in the model picker).
    // Remap to the valid ID so existing misconfigured agents keep working
    // without a manual DB update.
    const requested = model || 'claude-sonnet-4-5-20250929';
    const BAD_MODEL_MAP: Record<string, string> = {
      'claude-sonnet-4-5-20250514': 'claude-sonnet-4-5-20250929',
    };
    this.model = BAD_MODEL_MAP[requested] ?? requested;
  }

  async generateCompletion(params: CompletionParams): Promise<CompletionResult> {
    try {
      // Separate system message from user/assistant messages
      // Anthropic uses a top-level `system` param, not a system role in messages
      const systemMessage = params.messages.find((m) => m.role === 'system')?.content || '';
      const chatMessages = params.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      // If response_format is json_object, prepend instruction to system message
      // since Anthropic doesn't have a native json_object mode
      let system = systemMessage;
      if (params.response_format?.type === 'json_object') {
        system += '\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no code fences, no explanation outside the JSON.';
      }

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: params.max_tokens ?? 1000,
        temperature: params.temperature ?? 0.5,
        system,
        messages: chatMessages,
      });

      // Extract text from content blocks
      const content = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('');

      // Strip markdown code fences if present (Anthropic sometimes wraps JSON)
      const cleaned = content.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

      return {
        content: cleaned,
        finish_reason: response.stop_reason || 'end_turn',
        usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens,
        },
      };
    } catch (error: any) {
      throw new OpenAIError(
        `Anthropic API error: ${error.message}`,
        error.status,
        error
      );
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: this.model,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}

// =============================================================================
// OpenAI Embedding Client (always OpenAI — Anthropic doesn't offer embeddings)
// =============================================================================
export class EmbeddingClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  private truncateForEmbedding(text: string): string {
    const MAX_CHARS = 20000;
    if (text.length <= MAX_CHARS) return text;
    return text.substring(0, MAX_CHARS) + '... [truncated]';
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    const truncatedText = this.truncateForEmbedding(text);
    // Retry transient 429/5xx/network failures with short exponential backoff.
    // Non-retriable errors (400 bad input, 401 auth) throw immediately.
    const MAX_ATTEMPTS = 3;
    let lastError: any;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await this.client.embeddings.create({
          model: OPENAI_MODELS.EMBEDDING,
          input: truncatedText,
          dimensions: OPENAI_MODELS.EMBEDDING_DIMENSIONS,
        });

        return {
          embedding: response.data[0].embedding,
          model: response.model,
          usage: {
            prompt_tokens: response.usage.prompt_tokens,
            total_tokens: response.usage.total_tokens,
          },
        };
      } catch (error: any) {
        lastError = error;
        const status: number | undefined = error?.status;
        const retriable = status === 429 || (typeof status === 'number' && status >= 500) || !status;
        if (!retriable || attempt === MAX_ATTEMPTS) break;
        const delayMs = 300 * Math.pow(2, attempt - 1); // 300ms, 600ms
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw new OpenAIError('Failed to generate embedding', lastError?.status, lastError);
  }

  async generateEmbeddings(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      const response = await this.client.embeddings.create({
        model: OPENAI_MODELS.EMBEDDING,
        input: texts,
        dimensions: OPENAI_MODELS.EMBEDDING_DIMENSIONS,
      });

      return response.data.map((item) => ({
        embedding: item.embedding,
        model: response.model,
        usage: {
          prompt_tokens: response.usage.prompt_tokens / texts.length,
          total_tokens: response.usage.total_tokens / texts.length,
        },
      }));
    } catch (error: any) {
      throw new OpenAIError('Failed to generate embeddings', error.status, error);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.generateEmbedding('test');
      return true;
    } catch (error) {
      if (error instanceof OpenAIError && error.statusCode === 401) {
        return false;
      }
      throw error;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an AI completion client based on agent configuration.
 * Uses Anthropic if configured, otherwise falls back to OpenAI.
 */
export function createCompletionClient(agent: Agent): AICompletionClient {
  const provider = agent.ai_provider || 'openai';
  const model = agent.ai_model;

  if (provider === 'anthropic' && agent.anthropic_api_key) {
    return new AnthropicCompletionClient(agent.anthropic_api_key, model);
  }

  return new OpenAICompletionClient(agent.openai_api_key, model);
}

/**
 * Create an AI completion client from explicit params (for categorizer which takes raw API key).
 */
export function createCompletionClientFromKey(
  provider: string,
  apiKey: string,
  model?: string
): AICompletionClient {
  if (provider === 'anthropic') {
    return new AnthropicCompletionClient(apiKey, model);
  }
  return new OpenAICompletionClient(apiKey, model);
}

/**
 * Create an embedding client (always OpenAI).
 */
export function createEmbeddingClient(openaiApiKey: string): EmbeddingClient {
  return new EmbeddingClient(openaiApiKey);
}

/**
 * Test an AI provider connection.
 */
export async function testAIConnection(
  provider: string,
  apiKey: string,
  model?: string
): Promise<boolean> {
  const client = createCompletionClientFromKey(provider, apiKey, model);
  return client.testConnection();
}
