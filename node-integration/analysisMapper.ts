/**
 * Analysis Mapper — maps Clarix engine output to your existing API contract.
 *
 * Drop this file into your Node.js Express server's `src/mappers/` directory.
 *
 * Your existing clients (browser extension + web app) expect:
 *   credibility: { score, confidence, category, label, color }
 *   analysis:    { explanation, summary, sourceQuality, biasIndicator, signals, recommendations }
 *   claims:      { total, verified, items[] }
 *
 * This mapper transforms the Clarix engine response into that exact shape.
 */

import type { ClarixEngineResponse, ClarixClaimAnalysis } from "../services/clarixEngineClient";

// ── Output types matching your existing API contract ────────────────

export interface CredibilityBlock {
  score: number;
  confidence: number;
  category: "high" | "good" | "mixed" | "low" | "very-low";
  label: string;
  color: "green" | "yellow" | "red";
}

export interface AnalysisBlock {
  explanation: string;
  summary: string;
  sourceQuality: string;
  biasIndicator: Array<{ signal: string; detail: string }>;
  signals: {
    positive: string[];
    negative: string[];
  };
  recommendations: string[];
}

export interface ClaimItem {
  text: string;
  status: "SUPPORTED" | "CONTRADICTED" | "UNVERIFIED";
  confidence: number;
  reason: string;
  sources: string[];
}

export interface ClaimsBlock {
  total: number;
  verified: number;
  contradicted: number;
  unverified: number;
  items: ClaimItem[];
}

export interface AnalyzeResponse {
  credibility: CredibilityBlock;
  analysis: AnalysisBlock;
  claims: ClaimsBlock;
  meta: {
    disclaimer: string;
    requestId: string | null;
  };
}

// ── Mapper ──────────────────────────────────────────────────────────

export function mapEngineToAnalyzeResponse(
  engine: ClarixEngineResponse
): AnalyzeResponse {
  return {
    credibility: {
      score: engine.authenticity_score,
      confidence: engine.overall_confidence,
      category: engine.category,
      label: engine.label,
      color: engine.color,
    },

    analysis: {
      explanation: engine.reasoning,
      summary: engine.summary,
      sourceQuality: engine.source_quality,
      biasIndicator: engine.bias_signals.map((b) => ({
        signal: b.signal,
        detail: b.detail,
      })),
      signals: {
        positive: engine.positive_signals,
        negative: engine.negative_signals,
      },
      recommendations: engine.how_to_verify,
    },

    claims: {
      total: engine.claims.length,
      verified: engine.claims.filter((c) => c.verdict === "SUPPORTED").length,
      contradicted: engine.claims.filter((c) => c.verdict === "CONTRADICTED").length,
      unverified: engine.claims.filter((c) => c.verdict === "UNVERIFIED").length,
      items: engine.claims.map(mapClaim),
    },

    meta: {
      disclaimer: engine.disclaimer,
      requestId: engine.request_id,
    },
  };
}

function mapClaim(c: ClarixClaimAnalysis): ClaimItem {
  return {
    text: c.claim,
    status: c.verdict,
    confidence: c.confidence,
    reason: c.reason,
    sources: c.credible_sources,
  };
}
