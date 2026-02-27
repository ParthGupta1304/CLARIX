const { authMiddleware, requireAuth, requireSession } = require('./auth.middleware');
const { generalLimiter, analysisLimiter, sessionLimiter, feedbackLimiter } = require('./rate-limit.middleware');
const { ApiError, notFoundHandler, errorHandler, asyncHandler } = require('./error.middleware');

module.exports = {
  // Auth
  authMiddleware,
  requireAuth,
  requireSession,
  
  // Rate limiting
  generalLimiter,
  analysisLimiter,
  sessionLimiter,
  feedbackLimiter,
  
  // Error handling
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler,
};
