const Redis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let redis = null;
let redisAvailable = false;

const createRedisClient = () => {
  if (redis) return redis;

  try {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Stop retrying after 3 attempts
        if (times > 3) {
          logger.warn('Redis max retries reached, giving up');
          return null; // Stop retrying
        }
        return Math.min(times * 200, 2000);
      },
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5000,
    });

    redis.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });

    redis.on('error', (err) => {
      // Only log once, not on every retry
      if (redisAvailable) {
        logger.error(`Redis error: ${err.message}`);
        redisAvailable = false;
      }
    });

    redis.on('close', () => {
      if (redisAvailable) {
        logger.warn('Redis connection closed');
        redisAvailable = false;
      }
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

const isRedisAvailable = () => redisAvailable;

const closeRedis = async () => {
  if (redis) {
    try {
      redis.disconnect();
    } catch (e) {
      // ignore
    }
    redis = null;
    redisAvailable = false;
  }
};

module.exports = {
  createRedisClient,
  getRedis,
  isRedisAvailable,
  closeRedis,
};
