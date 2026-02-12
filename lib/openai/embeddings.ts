import { createOpenAIClient } from './client';
import { createEmbedding, createEmbeddings, deleteAgentEmbeddings } from '../supabase/queries';
import type { Agent, KnowledgeBaseEmbedding, ContentType } from '../types';
import { chunkArray } from '../utils';
import { RAG_CONFIG } from '../constants';

/**
 * Process and chunk text into smaller pieces for embedding
 */
function chunkText(text: string, maxTokens: number = RAG_CONFIG.CHUNK_SIZE): string[] {
  // Simple chunking by sentences (can be improved with better tokenization)
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    // Rough estimate: ~4 chars per token
    const estimatedTokens = (currentChunk + sentence).length / 4;

    if (estimatedTokens > maxTokens && currentChunk) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

/**
 * Generate embeddings for agent knowledge base
 */
export async function generateKnowledgeBaseEmbeddings(agent: Agent): Promise<void> {
  const openaiClient = createOpenAIClient(agent.openai_api_key);

  // Delete existing embeddings for this agent
  await deleteAgentEmbeddings(agent.id);

  const embeddingsToCreate: Omit<KnowledgeBaseEmbedding, 'id' | 'created_at'>[] = [];

  // Process knowledge base
  if (agent.knowledge_base) {
    const kbTexts: string[] = [];

    if (agent.knowledge_base.company_info) {
      kbTexts.push(...chunkText(agent.knowledge_base.company_info));
    }

    if (agent.knowledge_base.product_description) {
      kbTexts.push(...chunkText(agent.knowledge_base.product_description));
    }

    if (agent.knowledge_base.value_propositions) {
      kbTexts.push(...agent.knowledge_base.value_propositions);
    }

    if (agent.knowledge_base.common_questions) {
      agent.knowledge_base.common_questions.forEach((qa) => {
        kbTexts.push(`Q: ${qa.question}\nA: ${qa.answer}`);
      });
    }

    if (agent.knowledge_base.custom_instructions) {
      kbTexts.push(...chunkText(agent.knowledge_base.custom_instructions));
    }

    // Generate embeddings in batches
    for (const batch of chunkArray(kbTexts, 20)) {
      const embeddings = await openaiClient.generateEmbeddings(batch);

      embeddings.forEach((embResult, index) => {
        embeddingsToCreate.push({
          agent_id: agent.id,
          content_type: 'knowledge_base',
          content_text: batch[index],
          metadata: { source: 'knowledge_base' },
          embedding: embResult.embedding,
          usage_count: 0,
        });
      });
    }
  }

  // Process objection handling
  if (agent.objection_handling) {
    const objectionTexts = Object.entries(agent.objection_handling).map(
      ([objection, response]) => `Objection: ${objection}\nResponse: ${response}`
    );

    for (const batch of chunkArray(objectionTexts, 20)) {
      const embeddings = await openaiClient.generateEmbeddings(batch);

      embeddings.forEach((embResult, index) => {
        embeddingsToCreate.push({
          agent_id: agent.id,
          content_type: 'objection_handling',
          content_text: batch[index],
          metadata: { source: 'objection_handling' },
          embedding: embResult.embedding,
          usage_count: 0,
        });
      });
    }
  }

  // Process case studies
  if (agent.case_studies && agent.case_studies.length > 0) {
    const caseStudyTexts = agent.case_studies.map(
      (cs) =>
        `Case Study: ${cs.title}\nDescription: ${cs.description}\nResults: ${cs.results}`
    );

    for (const batch of chunkArray(caseStudyTexts, 20)) {
      const embeddings = await openaiClient.generateEmbeddings(batch);

      embeddings.forEach((embResult, index) => {
        embeddingsToCreate.push({
          agent_id: agent.id,
          content_type: 'case_study',
          content_text: batch[index],
          metadata: { source: 'case_study' },
          embedding: embResult.embedding,
          usage_count: 0,
        });
      });
    }
  }

  // Process learned patterns
  if (agent.learned_patterns && agent.learned_patterns.length > 0) {
    const patternTexts = agent.learned_patterns.map(
      (pattern) =>
        `Pattern: ${pattern.description}\nExamples: ${pattern.examples.join(', ')}`
    );

    for (const batch of chunkArray(patternTexts, 20)) {
      const embeddings = await openaiClient.generateEmbeddings(batch);

      embeddings.forEach((embResult, index) => {
        embeddingsToCreate.push({
          agent_id: agent.id,
          content_type: 'learned_pattern',
          content_text: batch[index],
          metadata: { source: 'learned_pattern' },
          embedding: embResult.embedding,
          usage_count: 0,
        });
      });
    }
  }

  // Batch insert all embeddings
  if (embeddingsToCreate.length > 0) {
    for (const batch of chunkArray(embeddingsToCreate, 50)) {
      await createEmbeddings(batch);
    }
  }
}

/**
 * Add a single learned pattern embedding
 */
export async function addLearnedPatternEmbedding(
  agentId: string,
  openaiApiKey: string,
  patternText: string,
  metadata: Record<string, any> = {}
): Promise<void> {
  const openaiClient = createOpenAIClient(openaiApiKey);
  const embResult = await openaiClient.generateEmbedding(patternText);

  await createEmbedding({
    agent_id: agentId,
    content_type: 'learned_pattern',
    content_text: patternText,
    metadata: { ...metadata, source: 'learned_pattern' },
    embedding: embResult.embedding,
    usage_count: 0,
  });
}
