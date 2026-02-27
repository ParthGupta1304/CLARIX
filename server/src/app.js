const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const routes = require('./routes');
const {
  authMiddleware,
  generalLimiter,
  notFoundHandler,
  errorHandler,
} = require('./middleware');
const logger = require('./utils/logger');

// Create Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for API
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
app.use(cors({
  origin: config.isDev 
    ? '*' 
    : [
        'chrome-extension://*',
        'moz-extension://*',
        /\.clarix\.app$/,
      ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  credentials: true,
  maxAge: 86400, // 24 hours
}));

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging
const morganFormat = config.isDev ? 'dev' : 'combined';
app.use(morgan(morganFormat, {
  stream: {
    write: (message) => logger.http(message.trim()),
  },
  skip: (req) => req.path === '/api/health',
}));

// Rate limiting (applied globally)
app.use('/api', generalLimiter);

// Authentication middleware (extracts session/API key)
app.use('/api', authMiddleware);

// API routes
app.use('/api', routes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'CLARIX API',
    version: '1.0.0',
    description: 'AI-powered news credibility scoring',
    documentation: '/api/docs',
    health: '/api/health',
  });
});

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
