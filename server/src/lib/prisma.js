const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'query' },
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' },
  ],
});

// Log queries in development
prisma.$on('query', (e) => {
  if (process.env.NODE_ENV === 'development') {
    logger.debug(`Query: ${e.query}`);
    logger.debug(`Duration: ${e.duration}ms`);
  }
});

prisma.$on('error', (e) => {
  logger.error(`Prisma Error: ${e.message}`);
});

module.exports = prisma;
