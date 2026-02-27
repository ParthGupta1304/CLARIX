const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');
const llmService = require('./llm.service');

/**
 * RAG (Retrieval-Augmented Generation) Service
 * Uses Supabase pgvector for vector similarity search.
 *
 * Prerequisites — run once in the Supabase SQL Editor:
 *   See server/supabase/setup.sql
 */
class RAGService {
  constructor() {
    this.supabase = null;
    this.initialized = false;
  }

  async init() {
    try {
      const { supabaseUrl, supabaseServiceKey } = config.supabase;

      if (!supabaseUrl || !supabaseServiceKey) {
        logger.warn('RAG Service: SUPABASE_URL or SUPABASE_SERVICE_KEY missing — running in disabled mode');
        return;
      }

      this.supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Quick connectivity check
      const { error } = await this.supabase.from('documents').select('id').limit(1);
      if (error && !error.message.includes('does not exist')) {
        logger.warn(`RAG Service: Supabase query test returned error: ${error.message}`);
      }

      this.initialized = true;
      logger.info('RAG Service initialized (Supabase pgvector)');
    } catch (error) {
      logger.error(`RAG Service init error: ${error.message}`);
    }
  }

  // ─── Store ────────────────────────────────────────────────────────────

  /**
   * Store a document embedding in Supabase for future retrieval.
   * Uses upsert on `doc_id` so seeds are idempotent.
   */
  async storeDocument(docId, text, metadata = {}) {
    if (!this.initialized) return false;

    try {
      const embedding = await llmService.generateEmbedding(text);
      if (!embedding) return false;

      const { error } = await this.supabase.from('documents').upsert(
        {
          doc_id: docId,
          content: text.substring(0, 2000),
          metadata,
          embedding,
        },
        { onConflict: 'doc_id' }
      );

      if (error) {
        logger.error(`RAG store error (Supabase): ${error.message}`);
        return false;
      }
      return true;
    } catch (error) {
      logger.error(`RAG store error: ${error.message}`);
      return false;
    }
  }

  // ─── Retrieve ─────────────────────────────────────────────────────────

  /**
   * Similarity search via the `match_documents` Postgres function.
   */
  async retrieve(query, topK = 5, similarityThreshold = 0.7) {
    if (!this.initialized) return [];

    try {
      const queryEmbedding = await llmService.generateEmbedding(query);
      if (!queryEmbedding) return [];

      const { data, error } = await this.supabase.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: similarityThreshold,
        match_count: topK,
      });

      if (error) {
        logger.error(`RAG retrieve error (Supabase RPC): ${error.message}`);
        return [];
      }

      return (data || []).map((row) => ({
        docId: row.doc_id,
        text: row.content,
        source: row.metadata?.source || 'Unknown',
        similarity: row.similarity,
        metadata: row.metadata,
      }));
    } catch (error) {
      logger.error(`RAG retrieve error: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieve context relevant to a set of claims.
   */
  async retrieveForClaims(claims) {
    if (!this.initialized) return [];

    try {
      const allResults = [];

      for (const claim of claims) {
        const claimText = claim.text || claim;
        const results = await this.retrieve(claimText, 3);
        allResults.push(...results);
      }

      // Deduplicate by docId
      const seen = new Set();
      return allResults.filter((r) => {
        if (seen.has(r.docId)) return false;
        seen.add(r.docId);
        return true;
      });
    } catch (error) {
      logger.error(`RAG claims retrieval error: ${error.message}`);
      return [];
    }
  }

  // ─── Seed ─────────────────────────────────────────────────────────────

  /**
   * Seed known reliable-source descriptions (idempotent via upsert).
   */
  async seedReliableSources() {
    if (!this.initialized) {
      logger.info('RAG seed skipped — service not initialized');
      return;
    }

    const reliableSources = [
      {
        id: 'reuters-about',
        text: 'Reuters is an international news organization known for factual, unbiased reporting. Founded in 1851, it is considered one of the most trusted news sources globally.',
        metadata: { source: 'reuters.com', type: 'source_info', reliability: 'high' },
      },
      {
        id: 'ap-about',
        text: 'The Associated Press (AP) is an American non-profit news agency. It is one of the largest and most trusted sources of independent newsgathering.',
        metadata: { source: 'apnews.com', type: 'source_info', reliability: 'high' },
      },
      {
        id: 'bbc-about',
        text: 'BBC News is an operational business division of the British Broadcasting Corporation responsible for the gathering and broadcasting of news and current affairs.',
        metadata: { source: 'bbc.com', type: 'source_info', reliability: 'high' },
      },
    ];

    for (const source of reliableSources) {
      await this.storeDocument(source.id, source.text, source.metadata);
    }

    logger.info('RAG seeded with reliable source information');
  }

  /**
   * Delete all rows (useful for dev reset).
   */
  async clear() {
    if (!this.initialized) return;
    const { error } = await this.supabase.from('documents').delete().neq('id', 0);
    if (error) logger.error(`RAG clear error: ${error.message}`);
  }
}

module.exports = new RAGService();
