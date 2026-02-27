const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let redis = null;

const createRedisClient = () => {
  if (redis) return redis;

  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });

    redis.on('error', (err) => {
      logger.error(`Redis error: ${err.message}`);
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    return redis;
  } catch (error) {
    logger.error(`Failed to create Redis client: ${error.message}`);
    return null;
  }
};

const getRedis = () => {
  if (!redis) {
    return createRedisClient();
  }
  return redis;
};

const closeRedis = async () => {
  if (redis) {
    await redis.quit();
    redis = null;
  }
};

module.exports = {
  createRedisClient,
  getRedis,
  closeRedis,
};
