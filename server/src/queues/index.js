const Queue = require('bull');
const config = require('../config');
const logger = require('../utils/logger');
const { isRedisAvailable } = require('../lib/redis');

// Lazy queue creation to avoid crashing at require-time when Redis is unavailable
let analysisQueue = null;
let feedQueue = null;
let queuesInitialized = false;

const initQueues = () => {
  if (queuesInitialized) return { analysisQueue, feedQueue };

  try {
    analysisQueue = new Queue('analysis', config.redisUrl, {
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 50,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
      },
    });

    feedQueue = new Queue('feed', config.redisUrl, {
      defaultJobOptions: {
        removeOnComplete: 50,
        removeOnFail: 20,
        attempts: 2,
      },
    });

    // Queue event handlers
    analysisQueue.on('completed', (job) => {
      logger.info(`Analysis job ${job.id} completed`);
    });

    analysisQueue.on('failed', (job, err) => {
      logger.error(`Analysis job ${job.id} failed: ${err.message}`);
    });

    analysisQueue.on('error', (err) => {
      logger.error(`Analysis queue error: ${err.message}`);
    });

    feedQueue.on('completed', (job) => {
      logger.info(`Feed job ${job.id} completed`);
    });

    feedQueue.on('failed', (job, err) => {
      logger.error(`Feed job ${job.id} failed: ${err.message}`);
    });

    queuesInitialized = true;
    logger.info('Bull queues initialized');
    return { analysisQueue, feedQueue };
  } catch (error) {
    logger.error(`Failed to initialize queues: ${error.message}`);
    return { analysisQueue: null, feedQueue: null };
  }
};

/**
 * Add analysis job to queue
 */
const queueAnalysis = async (data, options = {}) => {
  if (!queuesInitialized || !analysisQueue) {
    throw new Error('Queue not available — Redis is required');
  }
  
  const job = await analysisQueue.add('analyze', data, {
    priority: options.priority || 1,
    delay: options.delay || 0,
  });
  return job;
};

/**
 * Add feed refresh job
 */
const queueFeedRefresh = async (data = {}) => {
  if (!queuesInitialized || !feedQueue) {
    throw new Error('Queue not available — Redis is required');
  }  
  
  const job = await feedQueue.add('refresh', data, {
    priority: 2,
  });
  return job;
};

/**
 * Get queue stats
 */
const getQueueStats = async () => {
  if (!queuesInitialized || !analysisQueue || !feedQueue) {
    return { analysis: null, feed: null, available: false };
  }

  const [analysisWaiting, analysisActive, analysisCompleted, analysisFailed] = await Promise.all([
    analysisQueue.getWaitingCount(),
    analysisQueue.getActiveCount(),
    analysisQueue.getCompletedCount(),
    analysisQueue.getFailedCount(),
  ]);

  const [feedWaiting, feedActive] = await Promise.all([
    feedQueue.getWaitingCount(),
    feedQueue.getActiveCount(),
  ]);

  return {
    available: true,
    analysis: {
      waiting: analysisWaiting,
      active: analysisActive,
      completed: analysisCompleted,
      failed: analysisFailed,
    },
    feed: {
      waiting: feedWaiting,
      active: feedActive,
    },
  };
};

/**
 * Graceful shutdown
 */
const closeQueues = async () => {
  const promises = [];
  if (analysisQueue) promises.push(analysisQueue.close());
  if (feedQueue) promises.push(feedQueue.close());
  if (promises.length > 0) {
    await Promise.all(promises);
    logger.info('Queues closed');
  }
};

module.exports = {
  initQueues,
  queueAnalysis,
  queueFeedRefresh,
  getQueueStats,
  closeQueues,
};
