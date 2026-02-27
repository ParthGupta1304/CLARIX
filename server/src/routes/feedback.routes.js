const express = require('express');
const router = express.Router();
const { feedController } = require('../controllers');
const { requireSession, feedbackLimiter } = require('../middleware');
const { validate, swipeFeedbackSchema } = require('../validators');

/**
 * @route   POST /api/feedback/swipe
 * @desc    Record swipe feedback
 * @access  Session required
 */
router.post(
  '/swipe',
  feedbackLimiter,
  requireSession,
  validate(swipeFeedbackSchema),
  feedController.recordSwipe
);

module.exports = router;
