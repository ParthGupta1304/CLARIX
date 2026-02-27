const config = require('../config');
const logger = require('../utils/logger');
const llmService = require('./llm.service');

/**
 * RAG (Retrieval-Augmented Generation) Service
 * Handles vector database operations for retrieving relevant context
 */
class RAGService {
  constructor() {
    // In production, this would connect to Pinecone, Weaviate, or similar
    this.vectorStore = new Map(); // In-memory fallback
    this.initialized = false;
  }

  async init() {
    try {
      // Initialize vector DB connection
      // For MVP, using in-memory storage
      // In production: connect to Pinecone/Weaviate/Qdrant
      logger.info('RAG Service initialized (in-memory mode)');
      this.initialized = true;
    } catch (error) {
      logger.error(`RAG Service init error: ${error.message}`);
    }
  }

  /**
   * Store document embedding for future retrieval
   */
  async storeDocument(docId, text, metadata = {}) {
    try {
      const embedding = await llmService.generateEmbedding(text);
      if (!embedding) return false;

      this.vectorStore.set(docId, {
        embedding,
        text: text.substring(0, 2000),
        metadata,
        createdAt: new Date(),
      });

      return true;
    } catch (error) {
      logger.error(`RAG store error: ${error.message}`);
      return false;
    }
  }

  /**
   * Retrieve relevant documents for a query
   */
  async retrieve(query, topK = 5) {
    try {
      const queryEmbedding = await llmService.generateEmbedding(query);
      if (!queryEmbedding) return [];

      const results = [];
      
      // Calculate cosine similarity with all stored documents
      for (const [docId, doc] of this.vectorStore) {
        const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
        results.push({
          docId,
          text: doc.text,
          source: doc.metadata.source || 'Unknown',
          similarity,
          metadata: doc.metadata,
        });
      }

      // Sort by similarity and return top K
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, topK).filter(r => r.similarity > 0.7);
    } catch (error) {
      logger.error(`RAG retrieve error: ${error.message}`);
      return [];
    }
  }

  /**
   * Retrieve context relevant to claims
   */
  async retrieveForClaims(claims) {
    try {
      const allResults = [];
      
      for (const claim of claims) {
        const claimText = claim.text || claim;
        const results = await this.retrieve(claimText, 3);
        allResults.push(...results);
      }

      // Deduplicate by docId
      const seen = new Set();
      return allResults.filter(r => {
        if (seen.has(r.docId)) return false;
        seen.add(r.docId);
        return true;
      });
    } catch (error) {
      logger.error(`RAG claims retrieval error: ${error.message}`);
      return [];
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Seed with known reliable sources (for MVP)
   */
  async seedReliableSources() {
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
   * Clear all stored documents
   */
  clear() {
    this.vectorStore.clear();
  }
}

module.exports = new RAGService();
