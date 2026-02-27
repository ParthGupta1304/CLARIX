const axios = require('axios');
const cheerio = require('cheerio');
const crypto = require('crypto');
const logger = require('../utils/logger');

class ContentParserService {
  /**
   * Generate URL hash for caching/deduplication
   */
  generateUrlHash(url) {
    const normalizedUrl = this.normalizeUrl(url);
    return crypto.createHash('sha256').update(normalizedUrl).digest('hex');
  }

  /**
   * Normalize URL for consistent hashing
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove tracking parameters
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'];
      trackingParams.forEach(param => urlObj.searchParams.delete(param));
      // Remove trailing slash
      let normalized = urlObj.toString();
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      return normalized.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }

  /**
   * Fetch and parse article content from URL
   */
  async parseUrl(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        timeout: 15000,
        maxRedirects: 5,
      });

      const $ = cheerio.load(response.data);
      const metadata = this.extractMetadata($, url);
      const content = this.extractContent($);
      const contentType = this.detectContentType($, content, url);

      return {
        success: true,
        urlHash: this.generateUrlHash(url),
        originalUrl: url,
        ...metadata,
        content,
        contentType,
      };
    } catch (error) {
      logger.error(`Failed to parse URL ${url}: ${error.message}`);
      return {
        success: false,
        error: error.message,
        urlHash: this.generateUrlHash(url),
        originalUrl: url,
      };
    }
  }

  /**
   * Extract metadata from HTML
   */
  extractMetadata($, url) {
    const metadata = {
      title: null,
      author: null,
      publishedAt: null,
      source: null,
      description: null,
      imageUrl: null,
    };

    // Title extraction (priority order)
    metadata.title = 
      $('meta[property="og:title"]').attr('content') ||
      $('meta[name="twitter:title"]').attr('content') ||
      $('h1').first().text().trim() ||
      $('title').text().trim() ||
      null;

    // Author extraction
    metadata.author =
      $('meta[name="author"]').attr('content') ||
      $('meta[property="article:author"]').attr('content') ||
      $('[rel="author"]').first().text().trim() ||
      $('[class*="author"]').first().text().trim() ||
      null;

    // Published date extraction
    const dateStr =
      $('meta[property="article:published_time"]').attr('content') ||
      $('meta[name="publish-date"]').attr('content') ||
      $('time[datetime]').attr('datetime') ||
      $('[class*="date"]').first().text().trim() ||
      null;
    
    if (dateStr) {
      const parsed = new Date(dateStr);
      if (!isNaN(parsed.getTime())) {
        metadata.publishedAt = parsed;
      }
    }

    // Source extraction
    try {
      const urlObj = new URL(url);
      metadata.source = urlObj.hostname.replace('www.', '');
    } catch {
      metadata.source = null;
    }

    // Description
    metadata.description =
      $('meta[property="og:description"]').attr('content') ||
      $('meta[name="description"]').attr('content') ||
      null;

    // Image URL
    metadata.imageUrl =
      $('meta[property="og:image"]').attr('content') ||
      $('meta[name="twitter:image"]').attr('content') ||
      null;

    return metadata;
  }

  /**
   * Extract main article content
   */
  extractContent($) {
    // Remove unwanted elements
    $('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share, .comments, [class*="sidebar"]').remove();

    // Try common article selectors
    const selectors = [
      'article',
      '[role="main"]',
      '.article-content',
      '.post-content',
      '.entry-content',
      '.story-body',
      '.article-body',
      'main',
      '#content',
    ];

    let content = '';
    for (const selector of selectors) {
      const element = $(selector);
      if (element.length > 0) {
        content = element.text().trim();
        if (content.length > 200) {
          break;
        }
      }
    }

    // Fallback to body if no article container found
    if (content.length < 200) {
      content = $('body').text().trim();
    }

    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    // Truncate if too long (for LLM processing)
    const maxLength = 15000;
    if (content.length > maxLength) {
      content = content.substring(0, maxLength) + '...';
    }

    return content;
  }

  /**
   * Detect content type for edge cases
   */
  detectContentType($, content, url) {
    const lowerContent = content.toLowerCase();
    const lowerUrl = url.toLowerCase();

    // Check for satire
    const satireIndicators = ['satire', 'parody', 'theonion', 'babylonbee', 'borowitz'];
    if (satireIndicators.some(ind => lowerUrl.includes(ind) || lowerContent.includes(ind))) {
      return 'SATIRE';
    }

    // Check for opinion
    const opinionIndicators = ['opinion', 'editorial', 'op-ed', 'commentary', 'perspective', 'analysis:'];
    if (opinionIndicators.some(ind => lowerUrl.includes(ind) || lowerContent.substring(0, 500).includes(ind))) {
      return 'OPINION';
    }

    // Check for breaking news
    const breakingIndicators = ['breaking:', 'breaking news', 'developing:', 'just in:'];
    if (breakingIndicators.some(ind => lowerContent.substring(0, 200).toLowerCase().includes(ind))) {
      return 'BREAKING';
    }

    return 'NEWS';
  }

  /**
   * Parse raw text input (not from URL)
   */
  parseText(text) {
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    
    // Clean and normalize text
    const cleanedText = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    const contentType = this.detectContentTypeFromText(cleanedText);

    return {
      success: true,
      urlHash: hash,
      originalUrl: null,
      title: this.extractTitleFromText(cleanedText),
      author: null,
      publishedAt: null,
      source: 'Direct Text Input',
      content: cleanedText,
      contentType,
    };
  }

  /**
   * Extract title from text (first sentence or heading)
   */
  extractTitleFromText(text) {
    const firstLine = text.split('\n')[0].trim();
    if (firstLine.length > 10 && firstLine.length < 200) {
      return firstLine;
    }
    const firstSentence = text.match(/^[^.!?]+[.!?]/);
    if (firstSentence && firstSentence[0].length < 200) {
      return firstSentence[0].trim();
    }
    return text.substring(0, 100) + '...';
  }

  /**
   * Detect content type from text
   */
  detectContentTypeFromText(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('satire') || lowerText.includes('parody')) {
      return 'SATIRE';
    }
    if (lowerText.startsWith('opinion:') || lowerText.includes('in my opinion') || lowerText.includes('i believe')) {
      return 'OPINION';
    }
    if (lowerText.startsWith('breaking:') || lowerText.includes('breaking news')) {
      return 'BREAKING';
    }
    
    return 'NEWS';
  }
}

module.exports = new ContentParserService();
