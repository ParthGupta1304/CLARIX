"""Pipeline orchestrator — chains all seven Clarix steps together."""

from __future__ import annotations

import asyncio
import logging
import time

from engine.summarizer import summarize
from engine.claim_extractor import extract_claims
from engine.claim_verifier import verify_claims
from engine.bias_analyzer import analyze_bias
from engine.scorer import compute_score
from engine.verdict import determine_verdict
from engine.guidance import generate_guidance
from engine.heuristics import assess_source_credibility, assess_evidence_quality
from schemas.response import CredibilityCategory, VerifyResponse

logger = logging.getLogger("clarix.pipeline")


# ── Helpers ────────────────────────────────────────────────────────────

def _score_to_category(score: int) -> CredibilityCategory:
    if score >= 85:
        return CredibilityCategory.HIGH
    if score >= 70:
        return CredibilityCategory.GOOD
    if score >= 55:
        return CredibilityCategory.MIXED
    if score >= 35:
        return CredibilityCategory.LOW
    return CredibilityCategory.VERY_LOW


def _score_to_color(score: int) -> str:
    if score >= 85:
        return "green"
    if score >= 65:
        return "yellow"
    return "red"


def _source_cred_to_quality(cred: int) -> str:
    if cred >= 20:
        return "institutional"
    if cred >= 12:
        return "journalism"
    if cred <= -25:
        return "misinfo"
    return "unknown"


_CONTENT_TYPE_ADJUSTMENTS: dict[str, int] = {
    "satire": -15,
    "opinion": -8,
    "breaking": -5,
}


async def run_pipeline(
    content: str,
    *,
    url: str | None = None,
    title: str | None = None,
    content_type: str | None = None,
    request_id: str | None = None,
) -> VerifyResponse:
    """Execute the full seven-step Clarix verification pipeline.

    Parameters
    ----------
    content : str
        Raw text extracted from the user's screen.
    url : str | None
        Optional source URL for credibility heuristics.
    title : str | None
        Optional article title (prepended to content for LLM context).
    content_type : str | None
        Content type hint for scoring adjustment (satire/opinion/breaking).
    request_id : str | None
        Caller's request ID echoed back in the response.

    Returns
    -------
    VerifyResponse
        Structured verification result.
    """
    t0 = time.perf_counter()

    # Prepend title to content when available for richer LLM context
    analysis_text = f"Title: {title}\n\n{content}" if title else content

    # ── Step 1 + Step 2 + Step 4 (independent — run in parallel) ───────
    summary_task = asyncio.create_task(summarize(analysis_text))
    claims_task = asyncio.create_task(extract_claims(analysis_text))
    bias_task = asyncio.create_task(analyze_bias(analysis_text))

    summary = await summary_task
    raw_claims = await claims_task
    bias_signals = await bias_task

    logger.info("Steps 1/2/4 complete — %d claims, %d bias signals", len(raw_claims), len(bias_signals))

    # ── Step 3 — Verify extracted claims ───────────────────────────────
    claim_analyses = await verify_claims(raw_claims)

    logger.info("Step 3 complete — %d analyses", len(claim_analyses))

    # ── Step 5 — Numerical scoring ─────────────────────────────────────
    source_cred = assess_source_credibility(url, content)
    evidence_qual = assess_evidence_quality(
        [{"confidence": c.confidence, "verdict": c.verdict.value} for c in claim_analyses]
    )
    score = compute_score(
        claim_analyses,
        bias_signals,
        source_credibility=source_cred,
        evidence_quality=evidence_qual,
    )

    # Apply content-type adjustment (satire/opinion/breaking)
    if content_type and content_type.lower() in _CONTENT_TYPE_ADJUSTMENTS:
        adj = _CONTENT_TYPE_ADJUSTMENTS[content_type.lower()]
        score = max(0, min(100, score + adj))
        logger.info("Content type '%s' adjustment: %+d → score now %d", content_type, adj, score)

    # ── Step 6 — Verdict ───────────────────────────────────────────────
    verdict = determine_verdict(score)

    # ── Step 7 — User guidance ─────────────────────────────────────────
    how_to_verify = await generate_guidance(summary, claim_analyses, bias_signals)

    # ── Compute Node-compatible fields ─────────────────────────────────
    supported = sum(1 for c in claim_analyses if c.verdict.value == "SUPPORTED")
    contradicted = sum(1 for c in claim_analyses if c.verdict.value == "CONTRADICTED")
    unverified = sum(1 for c in claim_analyses if c.verdict.value == "UNVERIFIED")

    # Overall confidence = average of per-claim confidences (fallback 0.5)
    overall_confidence = (
        sum(c.confidence for c in claim_analyses) / len(claim_analyses)
        if claim_analyses
        else 0.5
    )

    # Positive / negative signals derived from bias analysis + claim stats
    positive_signals: list[str] = []
    negative_signals: list[str] = []

    if supported > 0:
        positive_signals.append(f"{supported} claim(s) supported by evidence")
    if source_cred >= 12:
        positive_signals.append("Source recognised as credible")
    if evidence_qual >= 5:
        positive_signals.append("Evidence quality is strong")

    if contradicted > 0:
        negative_signals.append(f"{contradicted} claim(s) contradicted")
    if unverified > 0:
        negative_signals.append(f"{unverified} claim(s) could not be verified")
    for sig in bias_signals:
        negative_signals.append(f"{sig.signal}: {sig.detail}" if sig.detail else sig.signal)
    if source_cred <= -10:
        negative_signals.append("Source not recognised or flagged")

    # Build reasoning paragraph
    reasoning = (
        f"Out of {len(claim_analyses)} extracted claim(s), "
        f"{supported} {'is' if supported == 1 else 'are'} supported, "
        f"{contradicted} {'is' if contradicted == 1 else 'are'} contradicted, "
        f"and {unverified} {'is' if unverified == 1 else 'are'} unverified. "
        f"Source credibility adjustment: {source_cred:+d}. "
        f"Evidence quality adjustment: {evidence_qual:+d}. "
        f"{len(bias_signals)} bias/manipulation signal(s) detected. "
        f"Final authenticity score: {score}/100."
    )

    elapsed = time.perf_counter() - t0
    logger.info("Pipeline complete in %.2fs — score %d/100 → %s", elapsed, score, verdict.value)

    return VerifyResponse(
        summary=summary,
        claims=claim_analyses,
        bias_signals=bias_signals,
        authenticity_score=score,
        verdict=verdict,
        reasoning=reasoning,
        how_to_verify=how_to_verify,
        # Node-server-compatible fields
        overall_confidence=round(overall_confidence, 3),
        category=_score_to_category(score),
        label=verdict.value,
        color=_score_to_color(score),
        source_quality=_source_cred_to_quality(source_cred),
        positive_signals=positive_signals,
        negative_signals=negative_signals,
        request_id=request_id,
    )
