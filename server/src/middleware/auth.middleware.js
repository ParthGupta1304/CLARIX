const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

/**
 * Extract session from JWT token or API key
 */
const authMiddleware = async (req, res, next) => {
  try {
    // Initialize as null
    req.sessionId = null;
    req.apiKey = null;

    // Check for API key header (for browser extension)
    const apiKey = req.get('X-API-Key');
    if (apiKey) {
      const validKey = await validateApiKey(apiKey);
      if (validKey) {
        req.apiKey = apiKey;
        req.apiKeyData = validKey;
        return next();
      }
    }

    // Check for Bearer token (for web app sessions)
    const authHeader = req.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, config.jwt.secret);
        
        // Verify session exists
        const session = await prisma.userSession.findUnique({
          where: { id: decoded.sessionId },
        });

        if (session) {
          req.sessionId = session.id;
          
          // Update last active timestamp (don't await)
          prisma.userSession.update({
            where: { id: session.id },
            data: { lastActiveAt: new Date() },
          }).catch(() => {}); // Ignore errors
        }
      } catch (jwtError) {
        // Token invalid or expired, but don't block request
        logger.debug(`JWT validation failed: ${jwtError.message}`);
      }
    }

    next();
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`);
    next();
  }
};

/**
 * Validate API key
 */
async function validateApiKey(key) {
  // Check against public API key first (for development)
  if (key === config.publicApiKey) {
    return { id: 'public', name: 'Public API Key', rateLimit: 100 };
  }

  // Check database for API key
  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { key },
    });

    if (apiKey && apiKey.isActive) {
      // Check expiration
      if (apiKey.expiresAt && new Date() > apiKey.expiresAt) {
        return null;
      }

      // Update usage count (don't await)
      prisma.apiKey.update({
        where: { id: apiKey.id },
        data: {
          usageCount: { increment: 1 },
          lastUsedAt: new Date(),
        },
      }).catch(() => {});

      return apiKey;
    }
  } catch (error) {
    logger.error(`API key validation error: ${error.message}`);
  }

  return null;
}

/**
 * Require authentication middleware
 * Use this for endpoints that require valid session or API key
 */
const requireAuth = (req, res, next) => {
  if (!req.sessionId && !req.apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required',
      message: 'Please provide a valid session token or API key',
    });
  }
  next();
};

/**
 * Require session middleware
 * Use this for endpoints that require a session (not API key)
 */
const requireSession = (req, res, next) => {
  if (!req.sessionId) {
    return res.status(401).json({
      success: false,
      error: 'Session required',
      message: 'Please create a session first',
    });
  }
  next();
};

module.exports = {
  authMiddleware,
  requireAuth,
  requireSession,
};
