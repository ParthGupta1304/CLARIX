/**
 * Bull queue worker example — async article analysis via Clarix engine.
 *
 * Drop into your Node.js server's queue workers directory, or merge the
 * pattern into your existing `analysisQueue` processor.
 *
 * This replaces inline LLM calls inside the worker with one HTTP call
 * to the Python Clarix engine.
 */

import Queue from "bull";
import { runClarixVerification } from "../services/clarixEngineClient";
import { mapEngineToAnalyzeResponse, AnalyzeResponse } from "../mappers/analysisMapper";

// ── Types ───────────────────────────────────────────────────────────

interface AnalysisJobData {
  /** SHA-256 hash of the normalised URL */
  urlHash: string;
  /** Original URL submitted by the user */
  originalUrl: string;
  /** Parsed article title (from Cheerio) */
  title: string;
  /** Parsed article text (from Cheerio) */
  content: string;
  /** Detected content type: news | opinion | satire | breaking */
  contentType?: string;
  /** Origin of the analysis request */
  sourceType?: string;
  /** ID of the analysis_requests row */
  requestId?: string;
}

// ── Queue setup ─────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const analysisQueue = new Queue<AnalysisJobData>("analysisQueue", REDIS_URL, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

// ── Processor ───────────────────────────────────────────────────────

analysisQueue.process(async (job) => {
  const { urlHash, originalUrl, title, content, contentType, sourceType, requestId } = job.data;

  console.log(`[analysisQueue] Processing ${urlHash} (attempt ${job.attemptsMade + 1})`);

  // Call the Clarix Python engine (replaces extractClaims + verifyClaims + analyzeCredibility)
  const engineResult = await runClarixVerification({
    content,
    title: title || undefined,
    url: originalUrl,
    contentType: contentType || undefined,
    sourceType: sourceType || "web",
    requestId: requestId || undefined,
  });

  // Map to your existing contract
  const mapped: AnalyzeResponse = mapEngineToAnalyzeResponse(engineResult);

  // ── Persist to DB (use your existing Prisma logic) ──────────────
  //
  // await prisma.analysisResult.create({
  //   data: {
  //     articleId: articleId,          // from prior step
  //     score: mapped.credibility.score,
  //     confidence: mapped.credibility.confidence,
  //     explanation: mapped.analysis.explanation,
  //     summary: mapped.analysis.summary,
  //     modelVersion: "clarix-0.2.0",
  //     rawResponse: JSON.stringify(engineResult),
  //   },
  // });
  //
  // // Store individual claims
  // for (const claim of mapped.claims.items) {
  //   await prisma.claim.create({
  //     data: {
  //       articleId,
  //       claimText: claim.text,
  //       verificationStatus: claim.status,
  //       confidence: claim.confidence,
  //       evidence: JSON.stringify({ reason: claim.reason, sources: claim.sources }),
  //     },
  //   });
  // }
  //
  // // Cache result
  // await redis.set(`analysis:${urlHash}`, JSON.stringify(mapped), "EX", CACHE_TTL);
  //
  // // Update analysis_requests status
  // if (requestId) {
  //   await prisma.analysisRequest.update({
  //     where: { id: requestId },
  //     data: { status: "completed", resultId: analysisResult.id },
  //   });
  // }

  console.log(`[analysisQueue] Done ${urlHash} — score=${mapped.credibility.score}`);
  return mapped;
});

// ── Event listeners ─────────────────────────────────────────────────

analysisQueue.on("failed", (job, err) => {
  console.error(`[analysisQueue] Job ${job.id} failed: ${err.message}`);
});

analysisQueue.on("completed", (job) => {
  console.log(`[analysisQueue] Job ${job.id} completed`);
});
