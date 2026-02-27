const express = require('express');
const router = express.Router();
const { sessionController } = require('../controllers');
const { requireSession, sessionLimiter } = require('../middleware');

/**
 * @route   POST /api/session
 * @desc    Create anonymous session
 * @access  Public (rate limited)
 */
router.post('/', sessionLimiter, sessionController.createSession);

/**
 * @route   GET /api/session
 * @desc    Get current session info
 * @access  Session required
 */
router.get('/', requireSession, sessionController.getSession);

/**
 * @route   PUT /api/session/activity
 * @desc    Update session activity timestamp
 * @access  Session required
 */
router.put('/activity', requireSession, sessionController.updateActivity);

/**
 * @route   DELETE /api/session
 * @desc    Delete session
 * @access  Session required
 */
router.delete('/', requireSession, sessionController.deleteSession);

module.exports = router;
