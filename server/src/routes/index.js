const express = require('express');
const analyzeRoutes = require('./analyze.routes');
const feedRoutes = require('./feed.routes');
const feedbackRoutes = require('./feedback.routes');
const sessionRoutes = require('./session.routes');
const adminRoutes = require('./admin.routes');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// API routes
router.use('/analyze', analyzeRoutes);
router.use('/feed', feedRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/session', sessionRoutes);
router.use('/admin', requireAuth, adminRoutes);

// Public stats endpoint for Quick Stats sidebar
const { analyzeController } = require('../controllers');
router.get('/stats', analyzeController.getStats);

module.exports = router;
