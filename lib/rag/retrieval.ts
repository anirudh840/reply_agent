import { createOpenAIClient } from '../openai/client';
import { searchKnowledgeBase } from '../supabase/queries';
import type { RetrievalResult } from '../types';
import { RAG_CONFIG } from '../constants';

/**
 * Retrieve relevant context from knowledge base for a given query
 */
export async function retrieveContext(params: {
  query: string;
  agentId: string;
  openaiApiKey: string;
  topK?: number;
  similarityThreshold?: number;
}): Promise<RetrievalResult[]> {
  const {
    query,
    agentId,
    openaiApiKey,
    topK = RAG_CONFIG.TOP_K_RESULTS,
    similarityThreshold = RAG_CONFIG.SIMILARITY_THRESHOLD,
  } = params;

  // Generate embedding for the query
  const openaiClient = createOpenAIClient(openaiApiKey);
  const embeddingResult = await openaiClient.generateEmbedding(query);

  // Search knowledge base using vector similarity
  const results = await searchKnowledgeBase(
    embeddingResult.embedding,
    agentId,
    topK,
    similarityThreshold
  );

  return results;
}

/**
 * Format retrieval results into a context string for prompts
 */
export function formatContextForPrompt(results: RetrievalResult[]): string {
  if (results.length === 0) {
    return 'No relevant context found in knowledge base.';
  }

  return results
    .map((result, index) => {
      const typeLabel = result.content_type.replace('_', ' ').toUpperCase();
      return `[${typeLabel} - Relevance: ${(result.similarity * 100).toFixed(1)}%]\n${result.content_text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Retrieve and format context in one step
 */
export async function getFormattedContext(params: {
  query: string;
  agentId: string;
  openaiApiKey: string;
  topK?: number;
  similarityThreshold?: number;
}): Promise<{ results: RetrievalResult[]; formattedContext: string }> {
  const results = await retrieveContext(params);
  const formattedContext = formatContextForPrompt(results);

  return {
    results,
    formattedContext,
  };
}
