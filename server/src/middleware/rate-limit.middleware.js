const rateLimit = require('express-rate-limit');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * General rate limiter for all API requests
 */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    success: false,
    error: 'Too many requests',
    message: 'Please try again later',
    retryAfter: Math.ceil(config.rateLimit.windowMs / 1000),
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use API key if present, otherwise IP
    return req.apiKey || req.ip;
  },
  handler: (req, res, next, options) => {
    logger.warn(`Rate limit exceeded for ${req.apiKey || req.ip}`);
    res.status(429).json(options.message);
  },
});

/**
 * Stricter rate limiter for analysis endpoints
 * Analysis is expensive (LLM calls), so limit more strictly
 */
const analysisLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    error: 'Analysis rate limit exceeded',
    message: 'You can analyze up to 10 articles per minute',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `analysis:${req.apiKey || req.sessionId || req.ip}`;
  },
  skip: (req) => {
    // Skip rate limiting for cached responses
    // This is handled in the controller by checking cache first
    return false;
  },
});

/**
 * Rate limiter for session creation
 */
const sessionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 sessions per hour per IP
  message: {
    success: false,
    error: 'Session creation rate limit exceeded',
    message: 'Too many sessions created. Please try again later.',
    retryAfter: 3600,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Rate limiter for feedback endpoints
 */
const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 swipes per minute
  message: {
    success: false,
    error: 'Feedback rate limit exceeded',
    message: 'Slow down! You\'re swiping too fast.',
    retryAfter: 60,
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return `feedback:${req.sessionId || req.ip}`;
  },
});

module.exports = {
  generalLimiter,
  analysisLimiter,
  sessionLimiter,
  feedbackLimiter,
};
