const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

class LLMService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.openai.apiKey,
    });
    this.model = config.openai.model;
  }

  /**
   * Extract claims from article content
   */
  async extractClaims(content, title = '') {
    const systemPrompt = `You are a fact-checking assistant specialized in identifying verifiable claims in news articles.
Your task is to extract factual claims that can be verified or fact-checked.

Rules:
1. Only extract claims that are factual assertions (not opinions or predictions)
2. Include statistical claims, quotes, and specific factual statements
3. Ignore general background information
4. Each claim should be self-contained and verifiable
5. Maximum 10 most important claims

Return a JSON array with the following structure:
{
  "claims": [
    {
      "text": "The exact claim text",
      "type": "FACTUAL|STATISTICAL|QUOTE",
      "importance": "HIGH|MEDIUM|LOW"
    }
  ]
}`;

    const userPrompt = `Article Title: ${title}\n\nArticle Content:\n${content.substring(0, 8000)}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.claims || [];
    } catch (error) {
      logger.error(`LLM claim extraction error: ${error.message}`);
      return [];
    }
  }

  /**
   * Analyze content for credibility signals
   */
  async analyzeCredibility(content, title = '', source = '', claims = []) {
    const systemPrompt = `You are an expert credibility analyst for news articles.
Analyze the provided article and assess its credibility based on:

1. Source reputation and reliability
2. Writing quality and journalistic standards
3. Presence of verifiable facts and citations
4. Balance and objectivity
5. Emotional manipulation or sensationalism
6. Logical consistency
7. Claim verifiability

Return a JSON object with:
{
  "score": <number 0-100>,
  "confidence": <number 0-1>,
  "explanation": "<detailed explanation of the score>",
  "summary": "<2-3 sentence summary of findings>",
  "signals": {
    "positive": ["<list of positive credibility signals>"],
    "negative": ["<list of negative credibility signals>"]
  },
  "sourceQuality": <number 0-1>,
  "biasIndicator": "LEFT|CENTER-LEFT|CENTER|CENTER-RIGHT|RIGHT|UNKNOWN",
  "recommendations": ["<suggestions for readers>"]
}

Scoring guidelines (CLARIX credibility bands):
- 90-100: AUTHORIZED — Highly credible, well-sourced, factual, verified by multiple reliable sources
- 60-89: SUSPICIOUS — Generally credible but unverified, minor issues, or limited sourcing. Needs caution.
- 40-59: FLAGGED — Mixed credibility, significant issues, likely misinformation or misleading
- 20-39: FLAGGED — Low credibility, major factual errors, unreliable sources
- 0-19: FLAGGED — Very low credibility, likely fake news or deliberate misinformation

IMPORTANT: Only assign 90+ to articles with strong sourcing, verified facts, and professional journalism standards. 
60-89 should be the default range for news with some but not full verification.
Below 60 should be reserved for clearly problematic content.`;

    const claimsSummary = claims.length > 0 
      ? `\n\nExtracted Claims:\n${claims.map((c, i) => `${i + 1}. ${c.text}`).join('\n')}`
      : '';

    const userPrompt = `Source: ${source || 'Unknown'}
Title: ${title}

Article Content:
${content.substring(0, 10000)}${claimsSummary}`;

    try {
      const startTime = Date.now();
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 2500,
        response_format: { type: 'json_object' },
      });

      const processingTime = Date.now() - startTime;
      const result = JSON.parse(response.choices[0].message.content);
      
      return {
        ...result,
        processingTime,
        modelVersion: this.model,
      };
    } catch (error) {
      logger.error(`LLM credibility analysis error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify individual claims using RAG context
   */
  async verifyClaims(claims, retrievedContext = []) {
    if (claims.length === 0) return [];

    const systemPrompt = `You are a fact-checker verifying claims against provided reference information.
For each claim, determine its verification status based on the provided context.

Return a JSON object with:
{
  "verifications": [
    {
      "claimIndex": <number>,
      "status": "VERIFIED|FALSE|MISLEADING|PARTIALLY_TRUE|UNVERIFIABLE",
      "confidence": <number 0-1>,
      "evidence": "<explanation with reference to sources>",
      "sources": ["<relevant source URLs or names>"]
    }
  ]
}

Status definitions:
- VERIFIED: Claim is accurate according to reliable sources
- FALSE: Claim is demonstrably false
- MISLEADING: Claim is technically true but presented in misleading context
- PARTIALLY_TRUE: Claim contains both accurate and inaccurate elements
- UNVERIFIABLE: Cannot determine truth due to lack of sources`;

    const contextText = retrievedContext.length > 0
      ? `\n\nReference Information:\n${retrievedContext.map((c, i) => `[${i + 1}] ${c.text}\nSource: ${c.source || 'Unknown'}`).join('\n\n')}`
      : '\n\nNo reference information available. Mark claims as UNVERIFIABLE if you cannot verify them from your training data.';

    const claimsText = claims.map((c, i) => `${i}. ${c.text || c}`).join('\n');
    const userPrompt = `Claims to verify:\n${claimsText}${contextText}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 3000,
        response_format: { type: 'json_object' },
      });

      const result = JSON.parse(response.choices[0].message.content);
      return result.verifications || [];
    } catch (error) {
      logger.error(`LLM claim verification error: ${error.message}`);
      return claims.map((_, i) => ({
        claimIndex: i,
        status: 'UNVERIFIABLE',
        confidence: 0,
        evidence: 'Verification failed due to system error',
        sources: [],
      }));
    }
  }

  /**
   * Generate embeddings for RAG
   */
  async generateEmbedding(text) {
    try {
      const response = await this.client.embeddings.create({
        model: 'text-embedding-3-small',
        input: text.substring(0, 8000),
      });
      return response.data[0].embedding;
    } catch (error) {
      logger.error(`Embedding generation error: ${error.message}`);
      return null;
    }
  }

  /**
   * Summarize article for feed
   */
  async summarizeForFeed(content, title = '') {
    const systemPrompt = `You are a news summarizer. Create a concise, factual summary suitable for a news feed card.

Return JSON:
{
  "summary": "<2-3 sentence summary, max 200 characters>",
  "tags": ["<relevant topic tags, max 5>"],
  "category": "<NEWS|POLITICS|TECHNOLOGY|SCIENCE|HEALTH|BUSINESS|ENTERTAINMENT|SPORTS|OTHER>"
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Title: ${title}\n\nContent: ${content.substring(0, 3000)}` },
        ],
        temperature: 0.5,
        max_tokens: 500,
        response_format: { type: 'json_object' },
      });

      return JSON.parse(response.choices[0].message.content);
    } catch (error) {
      logger.error(`Summarization error: ${error.message}`);
      return {
        summary: title || content.substring(0, 200),
        tags: [],
        category: 'OTHER',
      };
    }
  }
}

module.exports = new LLMService();
