import OpenAI from 'openai';
import { OPENAI_MODELS } from '../constants';
import { OpenAIError, type EmbeddingResult } from '../types';

export class OpenAIClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
    });
  }

  /**
   * Truncate text to prevent token limit errors
   * Embedding model max is 8192 tokens, ~4 chars per token
   * We'll limit to 20000 chars to be safe (~5000 tokens)
   */
  private truncateForEmbedding(text: string): string {
    const MAX_CHARS = 20000;
    if (text.length <= MAX_CHARS) return text;
    return text.substring(0, MAX_CHARS) + '... [truncated]';
  }

  /**
   * Generate embeddings for text
   */
  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    try {
      // Truncate text to prevent token limit errors
      const truncatedText = this.truncateForEmbedding(text);

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
      throw new OpenAIError(
        'Failed to generate embedding',
        error.status,
        error
      );
    }
  }

  /**
   * Generate embeddings for multiple texts
   */
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
      throw new OpenAIError(
        'Failed to generate embeddings',
        error.status,
        error
      );
    }
  }

  /**
   * Generate chat completion
   */
  async generateCompletion(params: {
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: 'json_object' | 'text' };
  }) {
    try {
      const response = await this.client.chat.completions.create({
        model: OPENAI_MODELS.GENERATION,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
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
      throw new OpenAIError(
        'Failed to generate completion',
        error.status,
        error
      );
    }
  }

  /**
   * Test API connection
   */
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

/**
 * Create an OpenAI client instance
 */
export function createOpenAIClient(apiKey: string): OpenAIClient {
  return new OpenAIClient(apiKey);
}
