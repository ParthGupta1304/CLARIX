const express = require('express');
const router = express.Router();
const { getQueueStats, queueFeedRefresh } = require('../queues');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * @route   GET /api/admin/stats
 * @desc    Get system stats (queue, DB counts)
 * @access  API Key required (admin)
 */
router.get('/stats', async (req, res, next) => {
  try {
    let queueStats = { available: false };
    try {
      queueStats = await getQueueStats();
    } catch (e) {
      // Queues not available (no Redis)
    }

    const [articleCount, analysisCount, feedItemCount, sessionCount] = await Promise.all([
      prisma.article.count(),
      prisma.analysisResult.count(),
      prisma.feedItem.count(),
      prisma.userSession.count(),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        queues: queueStats,
        database: {
          articles: articleCount,
          analyses: analysisCount,
          feedItems: feedItemCount,
          sessions: sessionCount,
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    });
  } catch (error) {
    logger.error(`Admin stats error: ${error.message}`);
    next(error);
  }
});

/**
 * @route   POST /api/admin/feed/refresh
 * @desc    Trigger manual feed refresh
 * @access  API Key required (admin)
 */
router.post('/feed/refresh', async (req, res, next) => {
  try {
    await queueFeedRefresh({ source: 'manual', triggeredBy: req.apiKey || 'unknown' });

    return res.status(202).json({
      success: true,
      data: {
        message: 'Feed refresh queued',
      },
    });
  } catch (error) {
    // If queue unavailable, return error
    if (error.message.includes('Queue not available')) {
      return res.status(503).json({
        success: false,
        error: 'Queue service unavailable',
        message: 'Redis is required for queue operations',
      });
    }
    logger.error(`Feed refresh error: ${error.message}`);
    next(error);
  }
});

module.exports = router;
