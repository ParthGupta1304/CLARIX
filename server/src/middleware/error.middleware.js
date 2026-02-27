const logger = require('../utils/logger');
const config = require('../config');

/**
 * Custom error class for API errors
 */
class ApiError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

/**
 * Not found handler
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
  });
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  // Log error
  logger.error(`Error: ${err.message}`);
  if (config.isDev) {
    logger.error(err.stack);
  }

  // Default error values
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let details = err.details || null;

  // Handle specific error types
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation Error';
  }

  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    message = 'Resource already exists';
  }

  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Resource not found';
  }

  // OpenAI errors
  if (err.message?.includes('OpenAI')) {
    statusCode = 503;
    message = 'AI service temporarily unavailable';
  }

  // Hide internal error details in production
  if (!config.isDev && statusCode === 500) {
    message = 'Internal Server Error';
    details = null;
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details && { details }),
    ...(config.isDev && { stack: err.stack }),
  });
};

/**
 * Async handler wrapper to catch errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = {
  ApiError,
  notFoundHandler,
  errorHandler,
  asyncHandler,
};
