const { getRedis } = require('../lib/redis');
const config = require('../config');
const logger = require('../utils/logger');

class CacheService {
  constructor() {
    this.redis = null;
    this.localCache = new Map(); // Fallback in-memory cache
    this.localCacheTTL = new Map();
  }

  async init() {
    try {
      this.redis = getRedis();
      if (this.redis) {
        await this.redis.ping();
      }
    } catch (error) {
      logger.warn('Redis not available, using in-memory cache');
      this.redis = null;
    }
  }

  /**
   * Get cached value
   */
  async get(key) {
    try {
      if (this.redis) {
        const value = await this.redis.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        // Fallback to local cache
        const expiry = this.localCacheTTL.get(key);
        if (expiry && Date.now() > expiry) {
          this.localCache.delete(key);
          this.localCacheTTL.delete(key);
          return null;
        }
        return this.localCache.get(key) || null;
      }
    } catch (error) {
      logger.error(`Cache get error: ${error.message}`);
      return null;
    }
  }

  /**
   * Set cached value with TTL
   */
  async set(key, value, ttlSeconds = config.cache.analysisTtl) {
    try {
      const serialized = JSON.stringify(value);
      if (this.redis) {
        await this.redis.setex(key, ttlSeconds, serialized);
      } else {
        // Fallback to local cache
        this.localCache.set(key, value);
        this.localCacheTTL.set(key, Date.now() + ttlSeconds * 1000);
      }
      return true;
    } catch (error) {
      logger.error(`Cache set error: ${error.message}`);
      return false;
    }
  }

  /**
   * Delete cached value
   */
  async delete(key) {
    try {
      if (this.redis) {
        await this.redis.del(key);
      } else {
        this.localCache.delete(key);
        this.localCacheTTL.delete(key);
      }
      return true;
    } catch (error) {
      logger.error(`Cache delete error: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if key exists
   */
  async exists(key) {
    try {
      if (this.redis) {
        return (await this.redis.exists(key)) === 1;
      }
      return this.localCache.has(key);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get cached analysis by URL hash
   */
  async getAnalysis(urlHash) {
    return this.get(`analysis:${urlHash}`);
  }

  /**
   * Cache analysis result
   */
  async setAnalysis(urlHash, result) {
    return this.set(`analysis:${urlHash}`, result, config.cache.analysisTtl);
  }

  /**
   * Get cached feed
   */
  async getFeed(category = 'all', page = 1) {
    return this.get(`feed:${category}:${page}`);
  }

  /**
   * Cache feed result
   */
  async setFeed(category = 'all', page = 1, items) {
    return this.set(`feed:${category}:${page}`, items, config.cache.feedTtl);
  }

  /**
   * Clear all cache (use with caution)
   */
  async flush() {
    try {
      if (this.redis) {
        await this.redis.flushdb();
      } else {
        this.localCache.clear();
        this.localCacheTTL.clear();
      }
      return true;
    } catch (error) {
      logger.error(`Cache flush error: ${error.message}`);
      return false;
    }
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService;
