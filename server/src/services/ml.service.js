/**
 * ML Service — calls the Python Clarix engine's /predict endpoint
 * for HuggingFace-based fake news detection.
 */

const config = require('../config');
const logger = require('../utils/logger');

const ENGINE_URL = config.clarixEngine.url;
const INTERNAL_TOKEN = config.clarixEngine.internalToken;

class MLService {
  /**
   * Call the HuggingFace fake news detector via the Python FastAPI engine.
   * Returns { label, confidence, real_probability, fake_probability }
   * or null if the engine is unavailable.
   */
  async predictFakeNews(text) {
    try {
      // Truncate to 5000 chars (model max_length is 256 tokens, but let the tokenizer do the truncation)
      const truncated = text.substring(0, 5000);

      const headers = { 'Content-Type': 'application/json' };
      if (INTERNAL_TOKEN) {
        headers['X-Internal-Token'] = INTERNAL_TOKEN;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${ENGINE_URL}/predict`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: truncated }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errBody = await response.text();
        logger.warn(`ML predict returned ${response.status}: ${errBody}`);
        return null;
      }

      const result = await response.json();
      logger.info(
        `ML prediction: ${result.label} (confidence: ${result.confidence}%, real: ${result.real_probability}%, fake: ${result.fake_probability}%)`
      );
      return result;
    } catch (error) {
      if (error.name === 'AbortError') {
        logger.warn('ML predict timed out after 30s');
      } else {
        logger.warn(`ML predict unavailable: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Check if the Python engine is healthy and has the HF model loaded.
   */
  async isAvailable() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${ENGINE_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) return false;
      const data = await response.json();
      return data.status === 'ok' && data.hf_model_loaded === true;
    } catch {
      return false;
    }
  }
}

module.exports = new MLService();
