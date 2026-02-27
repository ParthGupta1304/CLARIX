const { z } = require('zod');

// URL Analysis request schema
const analyzeUrlSchema = z.object({
  url: z.string().url('Invalid URL format'),
});

// Text Analysis request schema
const analyzeTextSchema = z.object({
  text: z.string()
    .min(50, 'Text must be at least 50 characters')
    .max(50000, 'Text must not exceed 50,000 characters'),
  title: z.string().max(500).optional(),
});

// Feed query schema
const feedQuerySchema = z.object({
  category: z.string().optional().default('all'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  minScore: z.coerce.number().int().min(0).max(100).optional().default(60),
  personalized: z.coerce.boolean().optional().default(false),
});

// Swipe feedback schema
const swipeFeedbackSchema = z.object({
  feedItemId: z.string().uuid('Invalid feed item ID'),
  direction: z.enum(['LEFT', 'RIGHT', 'UP', 'DOWN']),
  dwellTime: z.number().int().min(0).optional(),
});

// Session creation schema
const createSessionSchema = z.object({
  userAgent: z.string().optional(),
});

/**
 * Validation middleware factory
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    try {
      const data = source === 'query' ? req.query : req.body;
      const validated = schema.parse(data);
      
      if (source === 'query') {
        req.validatedQuery = validated;
      } else {
        req.validatedBody = validated;
      }
      
      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          success: false,
          error: 'Validation Error',
          details: error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
      }
      next(error);
    }
  };
};

module.exports = {
  analyzeUrlSchema,
  analyzeTextSchema,
  feedQuerySchema,
  swipeFeedbackSchema,
  createSessionSchema,
  validate,
};
