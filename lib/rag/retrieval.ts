import { createEmbeddingClient } from '../ai/client';
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
  const embeddingClient = createEmbeddingClient(openaiApiKey);
  const embeddingResult = await embeddingClient.generateEmbedding(query);

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
 * Retrieve and format context in one step.
 *
 * RAG is an *enhancement*, not a blocker. If the embedding API call fails
 * (OpenAI rate limit, 5xx, timeout, bad input) the caller still needs to
 * generate a response — it just loses a bit of context. We catch the failure
 * here, log it, and return an empty RAG section. The generator's prompt also
 * always includes the full knowledge base and objection list inline, so
 * responses without RAG are still usable.
 */
export async function getFormattedContext(params: {
  query: string;
  agentId: string;
  openaiApiKey: string;
  topK?: number;
  similarityThreshold?: number;
}): Promise<{ results: RetrievalResult[]; formattedContext: string }> {
  try {
    const results = await retrieveContext(params);
    const formattedContext = formatContextForPrompt(results);
    return { results, formattedContext };
  } catch (error: any) {
    console.warn(
      `[RAG] embedding retrieval failed, falling back to empty context. agent=${params.agentId} error=${error?.message || error}`
    );
    return {
      results: [],
      formattedContext: 'No relevant context retrieved (embedding unavailable).',
    };
  }
}
