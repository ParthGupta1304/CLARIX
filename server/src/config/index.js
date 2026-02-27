require('dotenv').config();

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: process.env.NODE_ENV === 'development',
  isProd: process.env.NODE_ENV === 'production',

  // Database
  databaseUrl: process.env.DATABASE_URL,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // API Keys
  publicApiKey: process.env.PUBLIC_API_KEY,

  // OpenAI / LLM
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
  },

  // Vector Database
  vectorDb: {
    apiKey: process.env.VECTOR_DB_API_KEY,
    environment: process.env.VECTOR_DB_ENVIRONMENT,
    index: process.env.VECTOR_DB_INDEX || 'clarix-embeddings',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Cache TTL (in seconds)
  cache: {
    analysisTtl: parseInt(process.env.CACHE_TTL_ANALYSIS, 10) || 3600,
    feedTtl: parseInt(process.env.CACHE_TTL_FEED, 10) || 300,
  },

  // Scoring thresholds
  scoring: {
    highCredibility: 70,
    mediumCredibility: 40,
    lowConfidenceThreshold: 0.5,
  },
};

module.exports = config;
