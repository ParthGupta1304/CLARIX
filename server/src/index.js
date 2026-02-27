require('dotenv').config();

const app = require('./app');
const config = require('./config');
const logger = require('./utils/logger');
const prisma = require('./lib/prisma');
const { createRedisClient, closeRedis } = require('./lib/redis');
const { cacheService, ragService } = require('./services');
const { startWorkers } = require('./queues/workers');
const { closeQueues } = require('./queues');

// Graceful shutdown handler
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  try {
    // Close server
    if (server) {
      server.close(() => {
        logger.info('HTTP server closed');
      });
    }

    // Close database connection
    await prisma.$disconnect();
    logger.info('Database disconnected');

    // Close Redis
    await closeRedis();
    logger.info('Redis disconnected');

    // Close queues
    await closeQueues();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error(`Error during shutdown: ${error.message}`);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error(`Uncaught Exception: ${error.message}`);
  logger.error(error.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Initialize services and start server
let server;

const start = async () => {
  try {
    logger.info('Starting CLARIX server...');

    // Connect to database
    await prisma.$connect();
    logger.info('Database connected');

    // Initialize Redis
    const redis = createRedisClient();
    if (redis) {
      await redis.connect().catch(() => {
        logger.warn('Redis connection failed, using in-memory cache');
      });
    }

    // Initialize cache service
    await cacheService.init();
    logger.info('Cache service initialized');

    // Initialize RAG service
    await ragService.init();
    await ragService.seedReliableSources();
    logger.info('RAG service initialized');

    // Start queue workers (if Redis available)
    if (redis) {
      startWorkers();
    }

    // Start HTTP server
    server = app.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`API available at http://localhost:${config.port}/api`);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${config.port} is already in use`);
      } else {
        logger.error(`Server error: ${error.message}`);
      }
      process.exit(1);
    });

  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    logger.error(error.stack);
    process.exit(1);
  }
};

// Start the server
start();
