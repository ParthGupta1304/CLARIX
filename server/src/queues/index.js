const Queue = require('bull');
const config = require('../config');
const logger = require('../utils/logger');

// Create queues
const analysisQueue = new Queue('analysis', config.redisUrl, {
  defaultJobOptions: {
    removeOnComplete: 100, // Keep last 100 completed jobs
    removeOnFail: 50, // Keep last 50 failed jobs
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  },
});

const feedQueue = new Queue('feed', config.redisUrl, {
  defaultJobOptions: {
    removeOnComplete: 50,
    removeOnFail: 20,
    attempts: 2,
  },
});

// Queue event handlers
analysisQueue.on('completed', (job, result) => {
  logger.info(`Analysis job ${job.id} completed`);
});

analysisQueue.on('failed', (job, err) => {
  logger.error(`Analysis job ${job.id} failed: ${err.message}`);
});

analysisQueue.on('error', (err) => {
  logger.error(`Analysis queue error: ${err.message}`);
});

feedQueue.on('completed', (job, result) => {
  logger.info(`Feed job ${job.id} completed`);
});

feedQueue.on('failed', (job, err) => {
  logger.error(`Feed job ${job.id} failed: ${err.message}`);
});

/**
 * Add analysis job to queue
 */
const queueAnalysis = async (data, options = {}) => {
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
  const job = await feedQueue.add('refresh', data, {
    priority: 2,
  });
  return job;
};

/**
 * Get queue stats
 */
const getQueueStats = async () => {
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
  await Promise.all([
    analysisQueue.close(),
    feedQueue.close(),
  ]);
  logger.info('Queues closed');
};

module.exports = {
  analysisQueue,
  feedQueue,
  queueAnalysis,
  queueFeedRefresh,
  getQueueStats,
  closeQueues,
};
