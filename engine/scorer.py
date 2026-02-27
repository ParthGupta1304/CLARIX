"""Step 5 — Numerical Scoring.

Deterministic scorer — no LLM call required.  Uses the weighted formula
specified in the Clarix protocol.
"""

from __future__ import annotations

from schemas.response import ClaimAnalysis, ClaimVerdict, BiasSignal


def compute_score(
    claims: list[ClaimAnalysis],
    bias_signals: list[BiasSignal],
    *,
    source_credibility: int = 0,
    evidence_quality: int = 0,
) -> int:
    """Compute an authenticity score between 0 and 100.

    Scoring formula
    ---------------
    Base score: 50

    Per-claim adjustments:
      SUPPORTED    → +12
      CONTRADICTED → −18
      UNVERIFIED   → −5

    Source credibility (passed in by pipeline heuristic):
      Highly reputable institutional source  → +20
      Recognised journalism outlet           → +12
      Unknown blog / social post             → −10
      Known misinformation patterns          → −25

    Evidence quality (passed in by pipeline heuristic):
      Multiple independent corroborations    → +15
      Single weak reference                  → −8
      No evidence                            → −12

    Manipulation signals (from bias analysis):
      Heavy sensationalism                   → −10
      Context omission                       → −8
      Misleading visuals                     → −12
    """
    score = 50

    # ── claim adjustments ──────────────────────────────────────────────
    for claim in claims:
        if claim.verdict == ClaimVerdict.SUPPORTED:
            score += 12
        elif claim.verdict == ClaimVerdict.CONTRADICTED:
            score -= 18
        elif claim.verdict == ClaimVerdict.UNVERIFIED:
            score -= 5

    # ── source credibility (externally determined) ─────────────────────
    score += source_credibility

    # ── evidence quality (externally determined) ───────────────────────
    score += evidence_quality

    # ── manipulation signal penalties ──────────────────────────────────
    _SIGNAL_PENALTIES: dict[str, int] = {
        "sensationalism": -10,
        "context omission": -8,
        "missing context": -8,
        "misleading visual": -12,
        "misleading image": -12,
        "clickbait": -8,
        "loaded language": -6,
        "emotional language": -6,
        "selective statistics": -8,
        "political slant": -6,
        "ideological slant": -6,
    }

    for sig in bias_signals:
        sig_lower = sig.signal.lower()
        penalty_applied = False
        for key, penalty in _SIGNAL_PENALTIES.items():
            if key in sig_lower:
                score += penalty
                penalty_applied = True
                break
        if not penalty_applied:
            # Generic unknown signal — mild penalty
            score -= 4

    return max(0, min(100, score))
