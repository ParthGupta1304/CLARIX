"""Unit tests for the deterministic engine components (scorer, verdict, heuristics)."""

from __future__ import annotations

import pytest

from engine.scorer import compute_score
from engine.verdict import determine_verdict
from engine.heuristics import assess_source_credibility, assess_evidence_quality
from schemas.response import ClaimAnalysis, ClaimVerdict, BiasSignal, OverallVerdict


# ── Helpers ────────────────────────────────────────────────────────────

def _claim(verdict: ClaimVerdict, confidence: float = 0.8) -> ClaimAnalysis:
    return ClaimAnalysis(
        claim="Test claim",
        verdict=verdict,
        confidence=confidence,
        reason="Test reason",
        credible_sources=[],
    )


def _bias(signal: str, detail: str = "") -> BiasSignal:
    return BiasSignal(signal=signal, detail=detail)


# ── Scorer tests ───────────────────────────────────────────────────────

class TestScorer:
    def test_base_score_no_claims_no_signals(self):
        score = compute_score([], [])
        assert score == 50

    def test_supported_claims_increase_score(self):
        claims = [_claim(ClaimVerdict.SUPPORTED) for _ in range(3)]
        score = compute_score(claims, [])
        assert score == 50 + 3 * 12  # 86

    def test_contradicted_claims_decrease_score(self):
        claims = [_claim(ClaimVerdict.CONTRADICTED) for _ in range(2)]
        score = compute_score(claims, [])
        assert score == 50 - 2 * 18  # 14

    def test_unverified_claims_decrease_score(self):
        claims = [_claim(ClaimVerdict.UNVERIFIED) for _ in range(4)]
        score = compute_score(claims, [])
        assert score == 50 - 4 * 5  # 30

    def test_bias_signals_apply_penalties(self):
        signals = [_bias("Sensationalism"), _bias("Missing context")]
        score = compute_score([], signals)
        assert score == 50 - 10 - 8  # 32

    def test_score_clamped_to_0(self):
        claims = [_claim(ClaimVerdict.CONTRADICTED) for _ in range(10)]
        score = compute_score(claims, [])
        assert score == 0

    def test_score_clamped_to_100(self):
        claims = [_claim(ClaimVerdict.SUPPORTED) for _ in range(10)]
        score = compute_score(claims, [], source_credibility=20, evidence_quality=15)
        assert score == 100

    def test_source_credibility_modifier(self):
        score = compute_score([], [], source_credibility=20)
        assert score == 70

    def test_evidence_quality_modifier(self):
        score = compute_score([], [], evidence_quality=-12)
        assert score == 38


# ── Verdict tests ──────────────────────────────────────────────────────

class TestVerdict:
    def test_verified(self):
        assert determine_verdict(85) == OverallVerdict.VERIFIED
        assert determine_verdict(100) == OverallVerdict.VERIFIED

    def test_questionable(self):
        assert determine_verdict(65) == OverallVerdict.QUESTIONABLE
        assert determine_verdict(84) == OverallVerdict.QUESTIONABLE

    def test_misleading(self):
        assert determine_verdict(0) == OverallVerdict.MISLEADING
        assert determine_verdict(64) == OverallVerdict.MISLEADING


# ── Heuristics tests ──────────────────────────────────────────────────

class TestSourceCredibility:
    def test_institutional_source(self):
        assert assess_source_credibility("https://who.int/report", "") == 20

    def test_journalism_source(self):
        assert assess_source_credibility("https://reuters.com/article/123", "") == 12

    def test_misinfo_source(self):
        assert assess_source_credibility("https://infowars.com/post", "") == -25

    def test_unknown_url(self):
        assert assess_source_credibility("https://unknownblog.example.com", "") == -10

    def test_no_url(self):
        assert assess_source_credibility(None, "Some random content") == -5

    def test_institutional_in_content(self):
        assert assess_source_credibility(None, "According to data from cdc.gov the rate is...") == 20


class TestEvidenceQuality:
    def test_no_claims(self):
        assert assess_evidence_quality([]) == -12

    def test_all_unverified(self):
        claims = [{"confidence": 0.5, "verdict": "UNVERIFIED"} for _ in range(3)]
        assert assess_evidence_quality(claims) == -12

    def test_high_confidence(self):
        claims = [{"confidence": 0.9, "verdict": "SUPPORTED"} for _ in range(3)]
        assert assess_evidence_quality(claims) == 15

    def test_low_confidence(self):
        claims = [{"confidence": 0.3, "verdict": "SUPPORTED"} for _ in range(2)]
        assert assess_evidence_quality(claims) == -8


# ── Integration-like test (no LLM) ────────────────────────────────────

class TestEndToEndScoring:
    """Full scoring path without LLM — exercises scorer + heuristics + verdict."""

    def test_reliable_article(self):
        claims = [_claim(ClaimVerdict.SUPPORTED, 0.9) for _ in range(3)]
        bias = []
        src_cred = assess_source_credibility("https://bbc.com/news/article", "")
        ev_qual = assess_evidence_quality(
            [{"confidence": c.confidence, "verdict": c.verdict.value} for c in claims]
        )
        score = compute_score(claims, bias, source_credibility=src_cred, evidence_quality=ev_qual)
        verdict = determine_verdict(score)
        assert score >= 85
        assert verdict == OverallVerdict.VERIFIED

    def test_misleading_post(self):
        claims = [_claim(ClaimVerdict.CONTRADICTED, 0.3), _claim(ClaimVerdict.UNVERIFIED, 0.2)]
        bias = [_bias("Sensationalism"), _bias("Clickbait"), _bias("Missing context")]
        src_cred = assess_source_credibility(None, "some facebook post says...")
        ev_qual = assess_evidence_quality(
            [{"confidence": c.confidence, "verdict": c.verdict.value} for c in claims]
        )
        score = compute_score(claims, bias, source_credibility=src_cred, evidence_quality=ev_qual)
        verdict = determine_verdict(score)
        assert score < 65
        assert verdict == OverallVerdict.MISLEADING
