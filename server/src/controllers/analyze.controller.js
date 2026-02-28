const { credibilityService, mlService } = require('../services');
const { queueAnalysis } = require('../queues');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Unified analyze endpoint (used by extension & frontend)
 * POST /api/analyze
 * Body: { type: "text"|"image"|"page", content: string, url?: string }
 */
const analyze = async (req, res, next) => {
  try {
    const { type, content, url } = req.body;
    const sessionId = req.sessionId || null;

    if (!type || !content) {
      return res.status(400).json({ success: false, error: 'Missing type or content' });
    }

    let result;

    if (type === 'page' && url) {
      // Try URL-based analysis first, fall back to text
      try {
        result = await credibilityService.analyzeUrl(url, sessionId);
      } catch {
        logger.info('URL parse failed, falling back to text analysis');
        result = await credibilityService.analyzeText(content, sessionId);
      }
    } else {
      // text or image (image text extracted by extension)
      result = await credibilityService.analyzeText(content, sessionId);
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Analyze error: ${error.message}`);
    next(error);
  }
};

/**
 * Analyze URL for credibility
 * POST /api/analyze/url
 */
const analyzeUrl = async (req, res, next) => {
  try {
    const { url } = req.validatedBody;
    const sessionId = req.sessionId || null;

    logger.info(`Analyzing URL: ${url}`);

    const result = await credibilityService.analyzeUrl(url, sessionId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Analyze URL error: ${error.message}`);
    
    // Handle specific error types
    if (error.message.includes('Failed to parse')) {
      return res.status(422).json({
        success: false,
        error: 'Unable to parse article',
        message: error.message,
      });
    }

    next(error);
  }
};

/**
 * Analyze raw text for credibility
 * POST /api/analyze/text
 */
const analyzeText = async (req, res, next) => {
  try {
    const { text, title } = req.validatedBody;
    const sessionId = req.sessionId || null;

    logger.info(`Analyzing text (${text.length} chars)`);

    const result = await credibilityService.analyzeText(text, sessionId);

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Analyze text error: ${error.message}`);
    next(error);
  }
};

/**
 * Get analysis by result ID
 * GET /api/analyze/:resultId
 */
const getAnalysis = async (req, res, next) => {
  try {
    const { resultId } = req.params;

    const result = await prisma.analysisResult.findUnique({
      where: { id: resultId },
      include: {
        article: {
          include: {
            claims: true,
          },
        },
      },
    });

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'Analysis not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: credibilityService.formatAnalysisResult(
        result.article,
        result,
        result.article.claims
      ),
    });
  } catch (error) {
    logger.error(`Get analysis error: ${error.message}`);
    next(error);
  }
};

/**
 * Get analysis history for session
 * GET /api/analyze/history
 * Returns frontend-compatible HistoryItem[]
 */
const getHistory = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;
    const { page = 1, limit = 20 } = req.query;

    const results = await prisma.analysisResult.findMany({
      where: sessionId
        ? { article: { analysisResults: { some: {} } } }
        : {},
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
      include: { article: true },
    });

    const items = results.map((r) => {
      const verdictMap = (s) =>
        s >= 70 ? 'Credible' : s >= 45 ? 'Uncertain' : 'Misleading';
      return {
        id: r.id,
        type: r.article?.contentType?.toLowerCase() === 'news' ? 'page' : 'text',
        title: r.article?.title || r.summary || 'Untitled Analysis',
        score: r.score,
        verdict: verdictMap(r.score),
        time: r.createdAt.toISOString(),
      };
    });

    return res.status(200).json({
      success: true,
      data: {
        items,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: items.length,
        },
      },
    });
  } catch (error) {
    logger.error(`Get history error: ${error.message}`);
    next(error);
  }
};

/**
 * Get aggregate stats for Quick Stats sidebar
 * GET /api/stats
 */
const getStats = async (req, res, next) => {
  try {
    const [analyses, flaggedCount, articleCount] = await Promise.all([
      prisma.analysisResult.aggregate({
        _sum: { factualClaims: true, verifiedClaims: true },
        _count: true,
      }),
      prisma.analysisResult.count({ where: { score: { lt: 60 } } }),
      prisma.article.count(),
    ]);

    const totalClaims = analyses._sum.factualClaims || 0;
    const verifiedClaims = analyses._sum.verifiedClaims || 0;
    const accuracyRate =
      totalClaims > 0 ? Math.round((verifiedClaims / totalClaims) * 100) : 0;

    return res.status(200).json({
      success: true,
      data: {
        claimsChecked: totalClaims,
        accuracyRate,
        pagesScanned: articleCount,
        flaggedItems: flaggedCount,
      },
    });
  } catch (error) {
    logger.error(`Stats error: ${error.message}`);
    next(error);
  }
};

/**
 * Queue async URL analysis (non-blocking)
 * POST /api/analyze/async/url
 */
const asyncAnalyzeUrl = async (req, res, next) => {
  try {
    const { url } = req.validatedBody;
    const sessionId = req.sessionId || null;

    // Create a pending request record
    const request = await prisma.analysisRequest.create({
      data: {
        sessionId,
        requestType: 'URL',
        inputUrl: url,
        inputHash: require('../services/content-parser.service').generateUrlHash(url),
        status: 'PENDING',
        ipAddress: req.ip || null,
      },
    });

    // Add to Bull queue
    try {
      await queueAnalysis({
        url,
        sessionId,
        requestId: request.id,
      });

      return res.status(202).json({
        success: true,
        data: {
          requestId: request.id,
          status: 'PENDING',
          message: 'Analysis queued. Poll /api/analyze/status/:requestId for results.',
          pollUrl: `/api/analyze/status/${request.id}`,
        },
      });
    } catch (queueError) {
      // If queue is unavailable, fall back to sync analysis
      logger.warn(`Queue unavailable, falling back to sync: ${queueError.message}`);
      const result = await credibilityService.analyzeUrl(url, sessionId);
      return res.status(200).json({
        success: true,
        data: result,
      });
    }
  } catch (error) {
    logger.error(`Async analyze URL error: ${error.message}`);
    next(error);
  }
};

/**
 * Check async analysis status
 * GET /api/analyze/status/:requestId
 */
const getAnalysisStatus = async (req, res, next) => {
  try {
    const { requestId } = req.params;

    const request = await prisma.analysisRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        error: 'Request not found',
      });
    }

    const response = {
      requestId: request.id,
      status: request.status,
      createdAt: request.createdAt,
    };

    // If completed, include result
    if (request.status === 'COMPLETED' && request.resultId) {
      const result = await prisma.analysisResult.findUnique({
        where: { id: request.resultId },
        include: {
          article: { include: { claims: true } },
        },
      });

      if (result) {
        response.result = credibilityService.formatAnalysisResult(
          result.article,
          result,
          result.article.claims
        );
      }
    }

    if (request.status === 'FAILED') {
      response.error = request.errorMessage;
    }

    return res.status(200).json({
      success: true,
      data: response,
    });
  } catch (error) {
    logger.error(`Get analysis status error: ${error.message}`);
    next(error);
  }
};

/**
 * Analyze uploaded image for deepfake detection
 * POST /api/analyze/image
 * Expects multipart/form-data with field "file"
 */
const analyzeImage = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No image file uploaded' });
    }

    const result = await mlService.detectDeepfake(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );

    if (!result) {
      return res.status(503).json({
        success: false,
        error: 'Deepfake detection service unavailable',
      });
    }

    const isReal = result.label === 'Real';
    const score = isReal
      ? Math.round(result.real_probability)
      : Math.round(100 - result.deepfake_probability);

    return res.status(200).json({
      success: true,
      data: {
        score,
        verdict: score >= 70 ? 'Credible' : score >= 45 ? 'Uncertain' : 'Misleading',
        analysisType: 'image',
        deepfakePrediction: {
          label: result.label,
          confidence: result.confidence,
          deepfakeProbability: result.deepfake_probability,
          realProbability: result.real_probability,
        },
        explanation: isReal
          ? `Image appears authentic (${result.confidence.toFixed(1)}% confidence). No deepfake artifacts detected.`
          : `Potential deepfake detected (${result.confidence.toFixed(1)}% confidence).`,
      },
    });
  } catch (error) {
    logger.error(`Analyze image error: ${error.message}`);
    next(error);
  }
};

module.exports = {
  analyze,
  analyzeUrl,
  analyzeText,
  analyzeImage,
  getAnalysis,
  getHistory,
  getStats,
  asyncAnalyzeUrl,
  getAnalysisStatus,
};
