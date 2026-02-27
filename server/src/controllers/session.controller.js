const prisma = require('../lib/prisma');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * Create anonymous session
 * POST /api/session
 */
const createSession = async (req, res, next) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    const session = await prisma.userSession.create({
      data: {
        sessionToken: uuidv4(),
        ipAddress,
        userAgent,
      },
    });

    // Generate JWT token
    const token = jwt.sign(
      { sessionId: session.id },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    return res.status(201).json({
      success: true,
      data: {
        sessionId: session.id,
        token,
        expiresIn: config.jwt.expiresIn,
      },
    });
  } catch (error) {
    logger.error(`Create session error: ${error.message}`);
    next(error);
  }
};

/**
 * Get current session info
 * GET /api/session
 */
const getSession = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No active session',
      });
    }

    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        preferences: true,
        createdAt: true,
        lastActiveAt: true,
        _count: {
          select: {
            swipes: true,
            analyses: true,
          },
        },
      },
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        sessionId: session.id,
        preferences: session.preferences,
        stats: {
          swipeCount: session._count.swipes,
          analysisCount: session._count.analyses,
        },
        createdAt: session.createdAt,
        lastActiveAt: session.lastActiveAt,
      },
    });
  } catch (error) {
    logger.error(`Get session error: ${error.message}`);
    next(error);
  }
};

/**
 * Update session activity
 * PUT /api/session/activity
 */
const updateActivity = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No active session',
      });
    }

    await prisma.userSession.update({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });

    return res.status(200).json({
      success: true,
      data: { updated: true },
    });
  } catch (error) {
    logger.error(`Update activity error: ${error.message}`);
    next(error);
  }
};

/**
 * Delete session
 * DELETE /api/session
 */
const deleteSession = async (req, res, next) => {
  try {
    const sessionId = req.sessionId;

    if (!sessionId) {
      return res.status(401).json({
        success: false,
        error: 'No active session',
      });
    }

    await prisma.userSession.delete({
      where: { id: sessionId },
    });

    return res.status(200).json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    logger.error(`Delete session error: ${error.message}`);
    next(error);
  }
};

module.exports = {
  createSession,
  getSession,
  updateActivity,
  deleteSession,
};
