/**
 * Route wiring example — integrating Clarix engine into your existing Express routes.
 *
 * Drop this file into your Node.js Express server or copy the patterns into
 * your existing `src/routes/analyze.ts`.
 *
 * This replaces the previous inline LLM calls (extractClaims, verifyClaims,
 * analyzeCredibility) with a single call to the Python Clarix engine.
 */

import { Router, Request, Response, NextFunction } from "express";
import { runClarixVerification, clarixHealthCheck } from "../services/clarixEngineClient";
import { mapEngineToAnalyzeResponse } from "../mappers/analysisMapper";

const router = Router();

// ── POST /api/analyze/text ──────────────────────────────────────────
//
// Replaces: extractClaims() → verifyClaims() → analyzeCredibility()
// With:     single call to Clarix Python engine

router.post("/text", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { text, title } = req.body;

    if (!text || typeof text !== "string" || text.trim().length === 0) {
      return res.status(400).json({ error: "text is required." });
    }

    const engineResult = await runClarixVerification({
      content: text,
      title: title || undefined,
      sourceType: "web",
      requestId: (req as any).id || undefined,
    });

    const response = mapEngineToAnalyzeResponse(engineResult);
    return res.json(response);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/analyze/url ───────────────────────────────────────────
//
// Keep your existing:
//   1. Normalize URL → SHA256 hash
//   2. Cache lookup (Redis)
//   3. Parse content (Cheerio)
//
// Then replace steps 4-7 (extract/retrieve/verify/analyze) with Clarix:

router.post("/url", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { url } = req.body;

    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "url is required." });
    }

    // ── Steps 1-3: your existing code ─────────────────────────────
    // const urlHash = normalizeAndHash(url);
    // const cached = await redisGet(`analysis:${urlHash}`);
    // if (cached) return res.json(JSON.parse(cached));
    // const { title, content, contentType } = await parseArticle(url);  // Cheerio

    // ── PLACEHOLDER — replace with your actual parsing logic ──────
    const title = ""; // ← from your Cheerio parser
    const content = ""; // ← from your Cheerio parser
    const contentType = "news"; // ← from your content-type detection

    // ── Steps 4-7: replaced by single Clarix engine call ──────────
    const engineResult = await runClarixVerification({
      content,
      title: title || undefined,
      url,
      contentType: contentType || undefined,
      sourceType: "extension",
      requestId: (req as any).id || undefined,
    });

    const response = mapEngineToAnalyzeResponse(engineResult);

    // ── Steps 9-10: store + cache ─────────────────────────────────
    // await storeAnalysis(urlHash, response);
    // await redisSet(`analysis:${urlHash}`, JSON.stringify(response), CACHE_TTL);

    return res.json(response);
  } catch (err) {
    next(err);
  }
});

// ── Health sub-route (optional) ─────────────────────────────────────

router.get("/engine-health", async (_req: Request, res: Response) => {
  const healthy = await clarixHealthCheck();
  return res.json({
    engine: "clarix",
    status: healthy ? "ok" : "unreachable",
  });
});

export default router;
