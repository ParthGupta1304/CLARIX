const prisma = require('../lib/prisma');
const config = require('../config');
const logger = require('../utils/logger');
const cacheService = require('./cache.service');
const contentParserService = require('./content-parser.service');
const llmService = require('./llm.service');
const mlService = require('./ml.service');
const ragService = require('./rag.service');

class CredibilityService {
  /**
   * Main entry point: Analyze URL for credibility
   */
  async analyzeUrl(url, sessionId = null) {
    const startTime = Date.now();
    const urlHash = contentParserService.generateUrlHash(url);

    try {
      // 1. Check cache first
      const cached = await cacheService.getAnalysis(urlHash);
      if (cached) {
        logger.info(`Cache hit for URL: ${url}`);
        await this.logRequest(sessionId, 'URL', url, urlHash, 'CACHED', cached.resultId);
        return { ...cached, cached: true };
      }

      // 2. Check database for existing analysis
      const existingArticle = await prisma.article.findUnique({
        where: { urlHash },
        include: {
          analysisResults: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          claims: true,
        },
      });

      if (existingArticle?.analysisResults?.length > 0) {
        const result = this.formatAnalysisResult(existingArticle, existingArticle.analysisResults[0]);
        await cacheService.setAnalysis(urlHash, result);
        await this.logRequest(sessionId, 'URL', url, urlHash, 'CACHED', result.resultId);
        return { ...result, cached: true };
      }

      // 3. Parse the URL content
      const parsed = await contentParserService.parseUrl(url);
      if (!parsed.success) {
        throw new Error(`Failed to parse URL: ${parsed.error}`);
      }

      // 4. Perform full analysis
      const result = await this.performAnalysis(parsed, sessionId);
      
      // 5. Cache the result
      await cacheService.setAnalysis(urlHash, result);
      
      logger.info(`Analysis completed for ${url} in ${Date.now() - startTime}ms`);
      return { ...result, cached: false };

    } catch (error) {
      logger.error(`Analysis error for ${url}: ${error.message}`);
      await this.logRequest(sessionId, 'URL', url, urlHash, 'FAILED', null, error.message);
      throw error;
    }
  }

  /**
   * Analyze raw text content
   */
  async analyzeText(text, sessionId = null) {
    const startTime = Date.now();
    const parsed = contentParserService.parseText(text);

    try {
      // Check cache
      const cached = await cacheService.getAnalysis(parsed.urlHash);
      if (cached) {
        await this.logRequest(sessionId, 'TEXT', null, parsed.urlHash, 'CACHED', cached.resultId);
        return { ...cached, cached: true };
      }

      // Perform analysis
      const result = await this.performAnalysis(parsed, sessionId);
      
      // Cache result
      await cacheService.setAnalysis(parsed.urlHash, result);
      
      logger.info(`Text analysis completed in ${Date.now() - startTime}ms`);
      return { ...result, cached: false };

    } catch (error) {
      logger.error(`Text analysis error: ${error.message}`);
      await this.logRequest(sessionId, 'TEXT', null, parsed.urlHash, 'FAILED', null, error.message);
      throw error;
    }
  }

  /**
   * Core analysis logic
   */
  async performAnalysis(parsed, sessionId = null) {
    const { urlHash, originalUrl, title, author, publishedAt, source, content, contentType } = parsed;

    // 1. Create or update article record
    const article = await prisma.article.upsert({
      where: { urlHash },
      create: {
        urlHash,
        originalUrl: originalUrl || '',
        title,
        author,
        publishedAt,
        source,
        content,
        contentType,
      },
      update: {
        title,
        author,
        publishedAt,
        source,
        content,
        contentType,
        updatedAt: new Date(),
      },
    });

    // 2. Extract claims + run ML prediction in parallel
    const [extractedClaims, mlPrediction] = await Promise.all([
      llmService.extractClaims(content, title),
      mlService.predictFakeNews(content).catch((err) => {
        logger.warn(`ML prediction failed: ${err.message}`);
        return null;
      }),
    ]);

    if (mlPrediction) {
      logger.info(
        `ML model says: ${mlPrediction.label} (${mlPrediction.confidence}% confidence, fake_prob=${mlPrediction.fake_probability}%)`
      );
    }
    
    // 3. Retrieve relevant context for claims (RAG)
    const retrievedContext = await ragService.retrieveForClaims(extractedClaims);

    // 4. Verify claims
    const verifications = await llmService.verifyClaims(extractedClaims, retrievedContext);

    // 5. Store claims in database
    const storedClaims = await this.storeClaims(article.id, extractedClaims, verifications);

    // 6. Get credibility analysis
    const credibilityResult = await llmService.analyzeCredibility(
      content, 
      title, 
      source, 
      extractedClaims
    );

    // 7. Adjust score based on content type edge cases
    const adjustedScore = this.adjustScoreForContentType(
      credibilityResult.score,
      credibilityResult.confidence,
      contentType
    );

    // 7b. Blend ML model prediction into the score (30% ML weight, 70% LLM weight)
    let finalScore = adjustedScore.score;
    if (mlPrediction) {
      // ML real_probability maps to credibility (high real_prob → high score)
      const mlScore = Math.round(mlPrediction.real_probability);
      finalScore = Math.round(adjustedScore.score * 0.7 + mlScore * 0.3);
      finalScore = Math.max(0, Math.min(100, finalScore));
      logger.info(
        `Score blending: LLM=${adjustedScore.score} + ML=${mlScore} → final=${finalScore}`
      );
    }

    // 8. Calculate verified claims count
    const verifiedCount = verifications.filter(v => v.status === 'VERIFIED').length;

    // 9. Store analysis result
    const analysisResult = await prisma.analysisResult.create({
      data: {
        articleId: article.id,
        score: finalScore,
        confidence: adjustedScore.confidence,
        explanation: credibilityResult.explanation,
        summary: credibilityResult.summary,
        factualClaims: extractedClaims.length,
        verifiedClaims: verifiedCount,
        sourceQuality: credibilityResult.sourceQuality,
        biasIndicator: credibilityResult.biasIndicator,
        factCheckScore: credibilityResult.breakdown?.factCheck ?? null,
        sourceCredScore: credibilityResult.breakdown?.sourceCredibility ?? null,
        sentimentScore: credibilityResult.breakdown?.sentimentBias ?? null,
        referenceSources: credibilityResult.referenceSources || [],
        modelVersion: credibilityResult.modelVersion,
        processingTime: credibilityResult.processingTime,
      },
    });

    // 10. Log the request
    await this.logRequest(sessionId, originalUrl ? 'URL' : 'TEXT', originalUrl, urlHash, 'COMPLETED', analysisResult.id);

    return this.formatAnalysisResult(article, analysisResult, storedClaims, credibilityResult, mlPrediction);
  }

  /**
   * Store claims in database
   */
  async storeClaims(articleId, extractedClaims, verifications) {
    const claims = [];

    for (let i = 0; i < extractedClaims.length; i++) {
      const claim = extractedClaims[i];
      const verification = verifications.find(v => v.claimIndex === i) || {};

      const storedClaim = await prisma.claim.create({
        data: {
          articleId,
          claimText: claim.text,
          claimType: this.mapClaimType(claim.type),
          isVerified: verification.status === 'VERIFIED',
          verificationStatus: verification.status || 'PENDING',
          confidence: verification.confidence || 0,
          evidence: verification.evidence || null,
          sources: verification.sources || [],
        },
      });

      claims.push(storedClaim);
    }

    return claims;
  }

  /**
   * Map claim type string to enum
   */
  mapClaimType(type) {
    const mapping = {
      'FACTUAL': 'FACTUAL',
      'STATISTICAL': 'STATISTICAL',
      'QUOTE': 'QUOTE',
      'OPINION': 'OPINION',
      'PREDICTION': 'PREDICTION',
    };
    return mapping[type?.toUpperCase()] || 'FACTUAL';
  }

  /**
   * Adjust score based on content type (edge cases)
   */
  adjustScoreForContentType(score, confidence, contentType) {
    let adjustedScore = score;
    let adjustedConfidence = confidence;
    let warning = null;

    switch (contentType) {
      case 'SATIRE':
        // Satire should be marked as unverifiable, not low credibility
        adjustedConfidence = 0;
        warning = 'This content appears to be satire and should not be taken as factual news.';
        break;

      case 'BREAKING':
        // Breaking news has naturally lower confidence
        adjustedConfidence = Math.min(confidence, config.scoring.lowConfidenceThreshold);
        warning = 'This is breaking news. Details may change as the story develops.';
        break;

      case 'OPINION':
        // Opinion pieces should be tagged, not scored as news
        warning = 'This is an opinion piece and represents the author\'s viewpoint.';
        break;

      default:
        break;
    }

    return {
      score: adjustedScore,
      confidence: adjustedConfidence,
      contentType,
      warning,
    };
  }

  /**
   * Format the final analysis result
   * Produces a shape consumed by:
   *   - Frontend (page.tsx)  → score, verdict, factCheck, sourceCredibility, sentimentBias, explanation, sources
   *   - Extension (popup.js) → trustScore, verdict{icon,text,explanation}, breakdown, sources
   *   - Internal / admin     → full credibility, extension, claims, meta blocks
   */
  formatAnalysisResult(article, analysisResult, claims = [], credibilityDetails = {}, mlPrediction = null) {
    const scoreCategory = this.getScoreCategory(analysisResult.score);
    const verdict = this.mapVerdict(analysisResult.score);

    // Breakdown scores (from DB columns, fall back to credibilityDetails from LLM)
    const factCheck        = analysisResult.factCheckScore  ?? credibilityDetails.breakdown?.factCheck ?? Math.round((analysisResult.sourceQuality || 0.5) * 100);
    const sourceCredibility = analysisResult.sourceCredScore ?? credibilityDetails.breakdown?.sourceCredibility ?? Math.round((analysisResult.sourceQuality || 0.5) * 100);
    const sentimentBias    = analysisResult.sentimentScore   ?? credibilityDetails.breakdown?.sentimentBias ?? 50;

    // Reference sources
    const sources = analysisResult.referenceSources
      || credibilityDetails.referenceSources
      || [];

    return {
      resultId: analysisResult.id,
      articleId: article.id,
      url: article.originalUrl,
      title: article.title,
      source: article.source,
      author: article.author,
      publishedAt: article.publishedAt,
      contentType: article.contentType,

      // ── Frontend-compatible top-level fields ──────────────
      score: analysisResult.score,
      verdict: verdict.label,                         // "Credible" | "Uncertain" | "Misleading"
      factCheck,
      sourceCredibility,
      sentimentBias,
      explanation: analysisResult.explanation,
      sources,                                        // [{ title, url }]

      // ── Extension-compatible block ────────────────────────
      trustScore: analysisResult.score,
      verdictDetail: {
        icon: verdict.icon,
        text: verdict.text,
        explanation: analysisResult.explanation,
      },
      breakdown: { factCheck, sourceCredibility, sentiment: sentimentBias },

      // ── Full credibility object (dashboard / admin) ───────
      credibility: {
        score: analysisResult.score,
        confidence: analysisResult.confidence,
        category: scoreCategory.category,
        color: scoreCategory.color,
        label: scoreCategory.label,
        badge: scoreCategory.badge,
      },

      // ── Browser extension overlay instructions ────────────
      extension: {
        action: scoreCategory.extensionAction,
        badgeText: `${analysisResult.score}%`,
        badgeColor: scoreCategory.color,
        showOverlay: scoreCategory.category === 'flagged',
        showWarning: scoreCategory.category === 'suspicious',
        overlayMessage: scoreCategory.category === 'flagged'
          ? 'This content has been flagged as potentially fake news by CLARIX.'
          : null,
        warningMessage: scoreCategory.category === 'suspicious'
          ? 'This content could not be fully verified. Proceed with caution.'
          : null,
      },

      // ── Analysis details ──────────────────────────────────
      analysis: {
        explanation: analysisResult.explanation,
        summary: analysisResult.summary,
        sourceQuality: analysisResult.sourceQuality,
        biasIndicator: analysisResult.biasIndicator,
        signals: credibilityDetails.signals || { positive: [], negative: [] },
        recommendations: credibilityDetails.recommendations || [],
      },

      // ── Claims ────────────────────────────────────────────
      claims: {
        total: analysisResult.factualClaims,
        verified: analysisResult.verifiedClaims,
        details: claims.map(c => ({
          id: c.id,
          text: c.claimText,
          type: c.claimType,
          status: c.verificationStatus,
          confidence: c.confidence,
        })),
      },

      // ── Meta ──────────────────────────────────────────────
      meta: {
        modelVersion: analysisResult.modelVersion,
        processingTime: analysisResult.processingTime,
        analyzedAt: analysisResult.createdAt,
      },

      // ── ML Model prediction (HuggingFace) ────────────────
      mlPrediction: mlPrediction
        ? {
            label: mlPrediction.label,
            confidence: mlPrediction.confidence,
            realProbability: mlPrediction.real_probability,
            fakeProbability: mlPrediction.fake_probability,
          }
        : null,
    };
  }

  /**
   * Map score → frontend verdict ("Credible" / "Uncertain" / "Misleading")
   * and extension verdict (icon + short text)
   */
  mapVerdict(score) {
    if (score >= 70) {
      return { label: 'Credible', icon: '✅', text: 'Likely Credible' };
    } else if (score >= 45) {
      return { label: 'Uncertain', icon: '⚠️', text: 'Unverified Claim' };
    } else {
      return { label: 'Misleading', icon: '🚫', text: 'Likely Misleading' };
    }
  }

  /**
   * Get score category based on CLARIX credibility bands
   * 90-100: AUTHORIZED   → Blue   → Trusted, verified news
   * 60-89:  SUSPICIOUS   → Red    → Unverified, proceed with caution
   * 0-59:   FLAGGED      → Block  → Likely fake, overlay/remove
   */
  getScoreCategory(score) {
    if (score >= 90) {
      return {
        category: 'authorized',
        color: '#3B82F6',         // Blue
        label: 'Authorized',
        badge: 'VERIFIED',
        extensionAction: 'show_blue_badge',
        feedVisible: true,
      };
    } else if (score >= 60) {
      return {
        category: 'suspicious',
        color: '#EF4444',         // Red
        label: 'Suspicious',
        badge: 'UNVERIFIED',
        extensionAction: 'show_red_badge',
        feedVisible: true,        // Shown in feed but marked red
      };
    } else {
      return {
        category: 'flagged',
        color: '#6B7280',         // Grey
        label: 'Flagged as Fake',
        badge: 'FAKE',
        extensionAction: 'show_overlay',  // White overlay / strikethrough
        feedVisible: false,       // NOT shown in feed
      };
    }
  }

  /**
   * Log analysis request
   */
  async logRequest(sessionId, type, url, hash, status, resultId = null, error = null) {
    try {
      await prisma.analysisRequest.create({
        data: {
          sessionId,
          requestType: type,
          inputUrl: url,
          inputHash: hash,
          status,
          resultId,
          errorMessage: error,
          completedAt: status === 'COMPLETED' || status === 'CACHED' ? new Date() : null,
        },
      });
    } catch (err) {
      logger.error(`Failed to log request: ${err.message}`);
    }
  }
}

module.exports = new CredibilityService();
