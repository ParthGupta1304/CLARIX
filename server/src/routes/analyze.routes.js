const express = require('express');
const router = express.Router();
const { analyzeController } = require('../controllers');
const { validate, analyzeUrlSchema, analyzeTextSchema } = require('../validators');

/**
 * @route   POST /api/analyze/url
 * @desc    Analyze URL for credibility
 * @access  Public (with API key) or Session
 */
router.post(
  '/url',
  validate(analyzeUrlSchema),
  analyzeController.analyzeUrl
);

/**
 * @route   POST /api/analyze/text
 * @desc    Analyze raw text for credibility
 * @access  Public (with API key) or Session
 */
router.post(
  '/text',
  validate(analyzeTextSchema),
  analyzeController.analyzeText
);

/**
 * @route   GET /api/analyze/history
 * @desc    Get analysis history for current session
 * @access  Session required
 */
router.get('/history', analyzeController.getHistory);

/**
 * @route   GET /api/analyze/:resultId
 * @desc    Get specific analysis result
 * @access  Public
 */
router.get('/:resultId', analyzeController.getAnalysis);

module.exports = router;
