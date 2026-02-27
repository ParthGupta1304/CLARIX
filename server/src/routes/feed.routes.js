const express = require('express');
const router = express.Router();
const { feedController } = require('../controllers');
const { validate, feedQuerySchema, swipeFeedbackSchema } = require('../validators');

/**
 * @route   GET /api/feed
 * @desc    Get feed items for swipeable reader
 * @access  Public
 */
router.get(
  '/',
  validate(feedQuerySchema, 'query'),
  feedController.getFeed
);

/**
 * @route   GET /api/feed/categories
 * @desc    Get available feed categories
 * @access  Public
 */
router.get('/categories', feedController.getCategories);

/**
 * @route   GET /api/feed/preferences
 * @desc    Get user feed preferences
 * @access  Session required
 */
router.get('/preferences', feedController.getPreferences);

/**
 * @route   GET /api/feed/:itemId
 * @desc    Get single feed item
 * @access  Public
 */
router.get('/:itemId', feedController.getFeedItem);

module.exports = router;
