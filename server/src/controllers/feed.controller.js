const { feedService } = require('../services');
const logger = require('../utils/logger');

/**
 * Get feed items
 * GET /api/feed
 */
const getFeed = async (req, res, next) => {
  try {
    const { category, page, limit, minScore, personalized } = req.validatedQuery;
    const sessionId = req.sessionId;

    let result;
    
    if (personalized && sessionId) {
      result = await feedService.getPersonalizedFeed(sessionId, {
        page,
        limit,
      });
    } else {
      result = await feedService.getFeed({
        category,
        page,
        limit,
        minScore,
        sessionId,
      });
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error(`Get feed error: ${error.message}`);
    next(error);
  }
};

/**
 * Record swipe feedback
 * POST /api/feedback/swipe
 */
const recordSwipe = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;
    
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session required for swipe feedback',
      });
    }

    const { feedItemId, direction, dwellTime } = req.validatedBody;

    const feedback = await feedService.recordSwipe(
      sessionId,
      feedItemId,
      direction,
      dwellTime
    );

    return res.status(200).json({
      success: true,
      data: {
        id: feedback.id,
        recorded: true,
      },
    });
  } catch (error) {
    logger.error(`Record swipe error: ${error.message}`);
    
    // Handle unique constraint violation (already swiped)
    if (error.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: 'Swipe already recorded',
      });
    }
    
    next(error);
  }
};

/**
 * Get user preferences
 * GET /api/feed/preferences
 */
const getPreferences = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;
    
    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'Session required for preferences',
      });
    }

    const preferences = await feedService.getPreferences(sessionId);

    return res.status(200).json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    logger.error(`Get preferences error: ${error.message}`);
    next(error);
  }
};

/**
 * Get available categories
 * GET /api/feed/categories
 */
const getCategories = async (req, res, next) => {
  try {
    const categories = await feedService.getCategories();

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    logger.error(`Get categories error: ${error.message}`);
    next(error);
  }
};

/**
 * Get single feed item
 * GET /api/feed/:itemId
 */
const getFeedItem = async (req, res, next) => {
  try {
    const { itemId } = req.params;
    const prisma = require('../lib/prisma');

    const item = await prisma.feedItem.findUnique({
      where: { id: itemId },
    });

    if (!item) {
      return res.status(404).json({
        success: false,
        error: 'Feed item not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: feedService.formatFeedItem(item),
    });
  } catch (error) {
    logger.error(`Get feed item error: ${error.message}`);
    next(error);
  }
};

module.exports = {
  getFeed,
  recordSwipe,
  getPreferences,
  getCategories,
  getFeedItem,
};
