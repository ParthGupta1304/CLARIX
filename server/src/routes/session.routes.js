const express = require('express');
const router = express.Router();
const { sessionController } = require('../controllers');

/**
 * @route   POST /api/session
 * @desc    Create anonymous session
 * @access  Public
 */
router.post('/', sessionController.createSession);

/**
 * @route   GET /api/session
 * @desc    Get current session info
 * @access  Session required
 */
router.get('/', sessionController.getSession);

/**
 * @route   PUT /api/session/activity
 * @desc    Update session activity timestamp
 * @access  Session required
 */
router.put('/activity', sessionController.updateActivity);

/**
 * @route   DELETE /api/session
 * @desc    Delete session
 * @access  Session required
 */
router.delete('/', sessionController.deleteSession);

module.exports = router;
