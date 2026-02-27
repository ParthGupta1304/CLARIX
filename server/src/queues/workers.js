const { initQueues } = require('./index');
const { credibilityService, feedService, llmService } = require('../services');
const config = require('../config');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Process analysis jobs
 */
const setupAnalysisWorker = () => {
  const { analysisQueue } = initQueues();
  if (!analysisQueue) {
    logger.warn('Analysis worker not started — queue unavailable');
    return;
  }

  analysisQueue.process('analyze', async (job) => {
    const { url, text, sessionId, requestId } = job.data;
    
    logger.info(`Processing analysis job ${job.id} for ${url || 'text input'}`);

    try {
      let result;
      
      if (url) {
        result = await credibilityService.analyzeUrl(url, sessionId);
      } else if (text) {
        result = await credibilityService.analyzeText(text, sessionId);
      } else {
        throw new Error('No URL or text provided');
      }

      // Update request status if requestId provided
      if (requestId) {
        await prisma.analysisRequest.update({
          where: { id: requestId },
          data: {
            status: 'COMPLETED',
            resultId: result.resultId,
            completedAt: new Date(),
          },
        });
      }

      return result;
    } catch (error) {
      logger.error(`Analysis job ${job.id} error: ${error.message}`);

      // Update request status on failure
      if (requestId) {
        await prisma.analysisRequest.update({
          where: { id: requestId },
          data: {
            status: 'FAILED',
            errorMessage: error.message,
          },
        }).catch(() => {});
      }

      throw error;
    }
  });

  logger.info('Analysis worker started');
};

/**
 * Process feed refresh jobs
 */
const setupFeedWorker = () => {
  const { feedQueue } = initQueues();
  if (!feedQueue) {
    logger.warn('Feed worker not started — queue unavailable');
    return;
  }

  feedQueue.process('refresh', async (job) => {
    logger.info(`Processing feed refresh job ${job.id}`);

    try {
      // Get articles analyzed in the last 24 hours
      const recentArticles = await prisma.article.findMany({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        include: {
          analysisResults: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        take: 50,
      });

      let added = 0;

      for (const article of recentArticles) {
        const analysis = article.analysisResults[0];
        if (!analysis || analysis.score < config.scoring.feedMinScore) continue; // Only add content above threshold

        // Check if already in feed
        const existing = await prisma.feedItem.findFirst({
          where: { sourceUrl: article.originalUrl },
        });

        if (!existing && article.originalUrl) {
          // Generate summary for feed
          const feedData = await llmService.summarizeForFeed(
            article.content || '',
            article.title || ''
          );

          await feedService.addFeedItem({
            title: article.title || 'Untitled',
            summary: feedData.summary,
            imageUrl: null,
            sourceUrl: article.originalUrl,
            sourceName: article.source || 'Unknown',
            credibilityScore: analysis.score,
            category: feedData.category,
            tags: feedData.tags,
            isVerified: true,
            publishedAt: article.publishedAt || new Date(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          });

          added++;
        }
      }

      logger.info(`Feed refresh complete: ${added} items added`);
      return { added };
    } catch (error) {
      logger.error(`Feed refresh error: ${error.message}`);
      throw error;
    }
  });

  logger.info('Feed worker started');
};

/**
 * Start all workers
 */
const startWorkers = () => {
  setupAnalysisWorker();
  setupFeedWorker();
  logger.info('All queue workers started');
};

module.exports = {
  startWorkers,
  setupAnalysisWorker,
  setupFeedWorker,
};
