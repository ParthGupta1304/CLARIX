/**
 * Clarix Engine Client — calls the Python verification pipeline.
 *
 * Drop this file into your Node.js Express server's `src/services/` directory.
 *
 * Required env vars:
 *   CLARIX_ENGINE_URL   — Python service URL  (default: http://127.0.0.1:8000)
 *   CLARIX_INTERNAL_TOKEN — shared secret matching INTERNAL_TOKEN in the Python .env
 */

import axios, { AxiosError } from "axios";

const CLARIX_ENGINE_URL =
  process.env.CLARIX_ENGINE_URL || "http://127.0.0.1:8000";
const CLARIX_INTERNAL_TOKEN = process.env.CLARIX_INTERNAL_TOKEN || "";

// ── Request payload ─────────────────────────────────────────────────

export interface ClarixVerifyInput {
  content: string;
  title?: string;
  url?: string;
  /** news | opinion | satire | breaking | social_post | caption | transcript */
  contentType?: string;
  /** extension | web | internal */
  sourceType?: string;
  /** caller's request ID for tracing */
  requestId?: string;
}

// ── Raw engine response types ───────────────────────────────────────

export interface ClarixClaimAnalysis {
  claim: string;
  verdict: "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
  confidence: number;
  reason: string;
  credible_sources: string[];
}

export interface ClarixBiasSignal {
  signal: string;
  detail: string;
}

export interface ClarixEngineResponse {
  summary: string;
  claims: ClarixClaimAnalysis[];
  bias_signals: ClarixBiasSignal[];
  authenticity_score: number;
  verdict: string;
  reasoning: string;
  how_to_verify: string[];
  disclaimer: string;

  // Node-compatible fields
  overall_confidence: number;
  category: "high" | "good" | "mixed" | "low" | "very-low";
  label: string;
  color: "green" | "yellow" | "red";
  source_quality: "institutional" | "journalism" | "unknown" | "misinfo";
  positive_signals: string[];
  negative_signals: string[];
  request_id: string | null;
}

// ── Client function ─────────────────────────────────────────────────

/**
 * Call the Clarix Python verification engine.
 *
 * @throws {Error} if the engine is unreachable or returns a non-2xx status.
 */
export async function runClarixVerification(
  payload: ClarixVerifyInput
): Promise<ClarixEngineResponse> {
  try {
    const res = await axios.post<ClarixEngineResponse>(
      `${CLARIX_ENGINE_URL}/verify`,
      payload,
      {
        timeout: 60_000, // pipeline can take 10-30s on first run
        headers: {
          "Content-Type": "application/json",
          ...(CLARIX_INTERNAL_TOKEN && {
            "X-Internal-Token": CLARIX_INTERNAL_TOKEN,
          }),
        },
      }
    );
    return res.data;
  } catch (err) {
    if (err instanceof AxiosError) {
      const status = err.response?.status ?? 0;
      const detail =
        err.response?.data?.detail ?? err.response?.data?.error ?? err.message;
      throw new Error(
        `Clarix engine error (HTTP ${status}): ${detail}`
      );
    }
    throw err;
  }
}

/**
 * Check if the Clarix engine is healthy.
 */
export async function clarixHealthCheck(): Promise<boolean> {
  try {
    const res = await axios.get(`${CLARIX_ENGINE_URL}/health`, {
      timeout: 5_000,
    });
    return res.data?.status === "ok";
  } catch {
    return false;
  }
}
