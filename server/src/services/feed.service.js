const prisma = require('../lib/prisma');
const config = require('../config');
const logger = require('../utils/logger');
const cacheService = require('./cache.service');

class FeedService {
  /**
   * Get feed items for swipeable reader
   */
  async getFeed(options = {}) {
    const {
      category = 'all',
      page = 1,
      limit = 20,
      minScore = config.scoring.feedMinScore, // Only show 60%+ (authorized + suspicious)
      sessionId = null,
    } = options;

    try {
      // Check cache first
      const cacheKey = `feed:${category}:${page}:${minScore}`;
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }

      // Build query conditions
      const where = {
        credibilityScore: { gte: minScore },
        isVerified: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      };

      if (category && category !== 'all') {
        where.category = category;
      }

      // Get items excluding already swiped
      let excludeIds = [];
      if (sessionId) {
        const swipedItems = await prisma.swipeFeedback.findMany({
          where: { sessionId },
          select: { feedItemId: true },
        });
        excludeIds = swipedItems.map(s => s.feedItemId);
      }

      if (excludeIds.length > 0) {
        where.id = { notIn: excludeIds };
      }

      // Fetch feed items
      const [items, total] = await Promise.all([
        prisma.feedItem.findMany({
          where,
          orderBy: [
            { publishedAt: 'desc' },
            { credibilityScore: 'desc' },
          ],
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.feedItem.count({ where }),
      ]);

      const result = {
        items: items.map(this.formatFeedItem),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
        filters: {
          category,
          minScore,
        },
      };

      // Cache result
      await cacheService.set(cacheKey, result, 300); // 5 min cache

      return { ...result, cached: false };
    } catch (error) {
      logger.error(`Feed fetch error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get personalized feed based on learned preferences
   */
  async getPersonalizedFeed(sessionId, options = {}) {
    const { page = 1, limit = 20 } = options;

    try {
      // Get user preferences from swipe history
      const preferences = await this.getPreferences(sessionId);

      // Build preference-weighted query
      const items = await this.fetchWithPreferences(preferences, page, limit, sessionId);

      return {
        items: items.map(this.formatFeedItem),
        pagination: {
          page,
          limit,
          hasMore: items.length === limit,
        },
        personalized: true,
        preferences: {
          favoredCategories: preferences.favoredCategories,
          favoredTags: preferences.favoredTags.slice(0, 5),
        },
      };
    } catch (error) {
      logger.error(`Personalized feed error: ${error.message}`);
      // Fallback to regular feed
      return this.getFeed({ ...options, sessionId });
    }
  }

  /**
   * Record swipe feedback
   */
  async recordSwipe(sessionId, feedItemId, direction, dwellTime = null) {
    try {
      // Upsert swipe feedback
      const feedback = await prisma.swipeFeedback.upsert({
        where: {
          sessionId_feedItemId: { sessionId, feedItemId },
        },
        create: {
          sessionId,
          feedItemId,
          direction,
          dwellTime,
        },
        update: {
          direction,
          dwellTime,
          createdAt: new Date(),
        },
      });

      // Update user preferences asynchronously
      this.updatePreferences(sessionId).catch(err => 
        logger.error(`Preference update error: ${err.message}`)
      );

      return feedback;
    } catch (error) {
      logger.error(`Swipe record error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get learned preferences for a session
   */
  async getPreferences(sessionId) {
    try {
      const session = await prisma.userSession.findUnique({
        where: { id: sessionId },
        select: { preferences: true },
      });

      if (session?.preferences) {
        return session.preferences;
      }

      // Calculate preferences from swipe history
      return this.calculatePreferences(sessionId);
    } catch (error) {
      logger.error(`Get preferences error: ${error.message}`);
      return { favoredCategories: [], favoredTags: [], avgDwellTime: 0 };
    }
  }

  /**
   * Calculate preferences from swipe history
   */
  async calculatePreferences(sessionId) {
    const swipes = await prisma.swipeFeedback.findMany({
      where: { sessionId },
      include: { feedItem: true },
      orderBy: { createdAt: 'desc' },
      take: 100, // Last 100 swipes
    });

    // Count category and tag preferences based on swipe direction
    const categoryScores = {};
    const tagScores = {};
    let totalDwellTime = 0;
    let dwellCount = 0;

    for (const swipe of swipes) {
      const weight = this.getSwipeWeight(swipe.direction);
      const item = swipe.feedItem;

      if (item.category) {
        categoryScores[item.category] = (categoryScores[item.category] || 0) + weight;
      }

      for (const tag of item.tags || []) {
        tagScores[tag] = (tagScores[tag] || 0) + weight;
      }

      if (swipe.dwellTime) {
        totalDwellTime += swipe.dwellTime;
        dwellCount++;
      }
    }

    // Sort and get top preferences
    const favoredCategories = Object.entries(categoryScores)
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category]) => category);

    const favoredTags = Object.entries(tagScores)
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag]) => tag);

    return {
      favoredCategories,
      favoredTags,
      avgDwellTime: dwellCount > 0 ? Math.round(totalDwellTime / dwellCount) : 0,
    };
  }

  /**
   * Get weight for swipe direction
   */
  getSwipeWeight(direction) {
    switch (direction) {
      case 'RIGHT': return 2;  // Interested
      case 'UP': return 3;     // Share (strong interest)
      case 'LEFT': return -1;  // Not interested
      case 'DOWN': return -2;  // Report (strong disinterest)
      default: return 0;
    }
  }

  /**
   * Update user preferences in database
   */
  async updatePreferences(sessionId) {
    const preferences = await this.calculatePreferences(sessionId);
    
    await prisma.userSession.update({
      where: { id: sessionId },
      data: {
        preferences,
        lastActiveAt: new Date(),
      },
    });
  }

  /**
   * Fetch items with preference weighting
   */
  async fetchWithPreferences(preferences, page, limit, sessionId) {
    const { favoredCategories, favoredTags } = preferences;

    // Get already swiped items
    const swipedItems = await prisma.swipeFeedback.findMany({
      where: { sessionId },
      select: { feedItemId: true },
    });
    const excludeIds = swipedItems.map(s => s.feedItemId);

    // Build OR conditions for preferences
    const preferenceConditions = [];
    
    if (favoredCategories.length > 0) {
      preferenceConditions.push({ category: { in: favoredCategories } });
    }
    
    if (favoredTags.length > 0) {
      preferenceConditions.push({ tags: { hasSome: favoredTags } });
    }

    const where = {
      credibilityScore: { gte: 60 },
      isVerified: true,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    };

    if (excludeIds.length > 0) {
      where.id = { notIn: excludeIds };
    }

    // First, try to get preference-matched items
    let items = [];
    if (preferenceConditions.length > 0) {
      items = await prisma.feedItem.findMany({
        where: {
          ...where,
          OR: preferenceConditions,
        },
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      });
    }

    // If not enough items, fill with general feed
    if (items.length < limit) {
      const remaining = limit - items.length;
      const existingIds = items.map(i => i.id);
      
      const fillItems = await prisma.feedItem.findMany({
        where: {
          ...where,
          id: { notIn: [...excludeIds, ...existingIds] },
        },
        orderBy: { publishedAt: 'desc' },
        take: remaining,
      });

      items = [...items, ...fillItems];
    }

    return items;
  }

  /**
   * Format feed item for response
   */
  formatFeedItem(item) {
    let tags = [];
    try {
      tags = typeof item.tags === 'string' ? JSON.parse(item.tags) : (item.tags || []);
    } catch (e) {
      tags = [];
    }

    // CLARIX feed card color logic
    // 90-100%: Blue (authorized)  |  60-89%: Red (suspicious)  |  <60%: hidden
    const score = item.credibilityScore;
    let cardColor, cardLabel;
    if (score >= 90) {
      cardColor = '#3B82F6'; // Blue
      cardLabel = 'Verified';
    } else {
      cardColor = '#EF4444'; // Red
      cardLabel = 'Unverified';
    }

    return {
      id: item.id,
      title: item.title,
      summary: item.summary,
      imageUrl: item.imageUrl,
      sourceUrl: item.sourceUrl,
      sourceName: item.sourceName,
      credibility: {
        score,
        verified: score >= 90,
        cardColor,
        cardLabel,
      },
      category: item.category,
      tags,
      publishedAt: item.publishedAt,
    };
  }

  /**
   * Add item to feed (internal use or admin)
   */
  async addFeedItem(data) {
    return prisma.feedItem.create({
      data: {
        title: data.title,
        summary: data.summary,
        imageUrl: data.imageUrl,
        sourceUrl: data.sourceUrl,
        sourceName: data.sourceName,
        credibilityScore: data.credibilityScore,
        category: data.category,
        tags: typeof data.tags === 'string' ? data.tags : JSON.stringify(data.tags || []),
        isVerified: data.isVerified ?? true,
        publishedAt: data.publishedAt || new Date(),
        expiresAt: data.expiresAt,
      },
    });
  }

  /**
   * Get available categories
   */
  async getCategories() {
    const categories = await prisma.feedItem.groupBy({
      by: ['category'],
      where: {
        category: { not: null },
        isVerified: true,
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return categories.map(c => ({
      name: c.category,
      count: c._count.id,
    }));
  }
}

module.exports = new FeedService();
