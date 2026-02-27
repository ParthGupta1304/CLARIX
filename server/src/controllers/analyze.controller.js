const { credibilityService } = require('../services');
const { queueAnalysis } = require('../queues');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

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
 */
const getHistory = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;
    const { page = 1, limit = 20 } = req.query;

    const requests = await prisma.analysisRequest.findMany({
      where: {
        sessionId,
        status: { in: ['COMPLETED', 'CACHED'] },
      },
      orderBy: { createdAt: 'desc' },
      skip: (parseInt(page) - 1) * parseInt(limit),
      take: parseInt(limit),
    });

    return res.status(200).json({
      success: true,
      data: {
        items: requests,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    logger.error(`Get history error: ${error.message}`);
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

module.exports = {
  analyzeUrl,
  analyzeText,
  getAnalysis,
  getHistory,
  asyncAnalyzeUrl,
  getAnalysisStatus,
};
