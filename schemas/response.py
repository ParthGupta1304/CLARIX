"""Response schemas for the Clarix API."""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# ── Enums ──────────────────────────────────────────────────────────────

class ClaimVerdict(str, Enum):
    SUPPORTED = "SUPPORTED"
    CONTRADICTED = "CONTRADICTED"
    UNVERIFIED = "UNVERIFIED"


class OverallVerdict(str, Enum):
    VERIFIED = "VERIFIED / HIGHLY RELIABLE"
    QUESTIONABLE = "QUESTIONABLE / NEEDS FACT CHECK"
    MISLEADING = "MISLEADING OR LIKELY FALSE"


# ── Sub-models ─────────────────────────────────────────────────────────

class ClaimAnalysis(BaseModel):
    claim: str
    verdict: ClaimVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str
    credible_sources: list[str] = Field(
        default_factory=list,
        description="Names of verifying institutions, databases, or organizations (never fabricated URLs).",
    )


class BiasSignal(BaseModel):
    signal: str
    detail: str


class CredibilityCategory(str, Enum):
    HIGH = "high"
    GOOD = "good"
    MIXED = "mixed"
    LOW = "low"
    VERY_LOW = "very-low"


# ── Top-level response ─────────────────────────────────────────────────

class VerifyResponse(BaseModel):
    """Full pipeline output.  Includes both the original Clarix fields and
    Node-server-compatible fields so the Express backend can consume this
    directly or via its mapper with zero data loss."""

    # ── Original Clarix fields ─────────────────────────────────────────
    summary: str = Field(description="Neutral 2-3 sentence summary.")
    claims: list[ClaimAnalysis] = Field(default_factory=list)
    bias_signals: list[BiasSignal] = Field(default_factory=list)
    authenticity_score: int = Field(ge=0, le=100)
    verdict: OverallVerdict
    reasoning: str
    how_to_verify: list[str] = Field(default_factory=list)
    disclaimer: str = "This credibility assessment is AI-generated and should not replace independent verification."

    # ── Node-server-compatible fields ──────────────────────────────────
    overall_confidence: float = Field(
        default=0.5, ge=0.0, le=1.0,
        description="Average confidence across all claim analyses.",
    )
    category: CredibilityCategory = Field(
        default=CredibilityCategory.MIXED,
        description="Score bucket: high | good | mixed | low | very-low.",
    )
    label: str = Field(default="", description="Short human-readable verdict label.")
    color: str = Field(default="yellow", description="UI color hint: green | yellow | red.")
    source_quality: str = Field(default="unknown", description="Source tier: institutional | journalism | unknown | misinfo.")
    positive_signals: list[str] = Field(default_factory=list, description="Positive credibility signals.")
    negative_signals: list[str] = Field(default_factory=list, description="Negative credibility signals.")
    request_id: str | None = Field(default=None, description="Echo of caller's request ID.")


class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None


class PredictResponse(BaseModel):
    """Output from the HuggingFace fake news detector."""

    label: str = Field(description="FAKE or REAL")
    confidence: float = Field(ge=0, le=100, description="Confidence % of the predicted label")
    real_probability: float = Field(ge=0, le=100, description="Probability % the text is real")
    fake_probability: float = Field(ge=0, le=100, description="Probability % the text is fake")
