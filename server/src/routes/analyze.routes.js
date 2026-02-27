const express = require('express');
const router = express.Router();
const { analyzeController } = require('../controllers');
const { requireAuth, requireSession, analysisLimiter } = require('../middleware');
const { validate, analyzeUrlSchema, analyzeTextSchema } = require('../validators');

/**
 * @route   POST /api/analyze/url
 * @desc    Analyze URL for credibility
 * @access  Requires API key or session
 */
router.post(
  '/url',
  analysisLimiter,
  requireAuth,
  validate(analyzeUrlSchema),
  analyzeController.analyzeUrl
);

/**
 * @route   POST /api/analyze/text
 * @desc    Analyze raw text for credibility
 * @access  Requires API key or session
 */
router.post(
  '/text',
  analysisLimiter,
  requireAuth,
  validate(analyzeTextSchema),
  analyzeController.analyzeText
);

/**
 * @route   GET /api/analyze/history
 * @desc    Get analysis history for current session
 * @access  Session required
 */
router.get('/history', requireSession, analyzeController.getHistory);

/**
 * @route   POST /api/analyze/async/url
 * @desc    Queue URL analysis (non-blocking, returns job ID for polling)
 * @access  Requires API key or session
 */
router.post(
  '/async/url',
  analysisLimiter,
  requireAuth,
  validate(analyzeUrlSchema),
  analyzeController.asyncAnalyzeUrl
);

/**
 * @route   GET /api/analyze/status/:requestId
 * @desc    Check async analysis status
 * @access  Public
 */
router.get('/status/:requestId', analyzeController.getAnalysisStatus);

/**
 * @route   GET /api/analyze/:resultId
 * @desc    Get specific analysis result
 * @access  Public
 */
router.get('/:resultId', analyzeController.getAnalysis);

module.exports = router;
