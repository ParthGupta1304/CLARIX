"""Step 6 — Verdict Categorisation."""

from __future__ import annotations

from schemas.response import OverallVerdict


def determine_verdict(score: int) -> OverallVerdict:
    """Map an authenticity score to a verdict tier.

    85–100 → VERIFIED / HIGHLY RELIABLE
    65–84  → QUESTIONABLE / NEEDS FACT CHECK
     0–64  → MISLEADING OR LIKELY FALSE
    """
    if score >= 85:
        return OverallVerdict.VERIFIED
    elif score >= 65:
        return OverallVerdict.QUESTIONABLE
    else:
        return OverallVerdict.MISLEADING
