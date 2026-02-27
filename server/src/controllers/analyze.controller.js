const { credibilityService } = require('../services');
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
    const prisma = require('../lib/prisma');

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
    const prisma = require('../lib/prisma');

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session required for history',
      });
    }

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

module.exports = {
  analyzeUrl,
  analyzeText,
  getAnalysis,
  getHistory,
};
