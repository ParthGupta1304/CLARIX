"""Source credibility & evidence quality heuristics.

These functions provide the ``source_credibility`` and ``evidence_quality``
modifiers consumed by the scorer.  They use simple keyword / domain matching so
the pipeline can run without any external API calls.
"""

from __future__ import annotations

import re

# ── Known domains / patterns ──────────────────────────────────────────

_INSTITUTIONAL: set[str] = {
    "who.int", "cdc.gov", "nih.gov", "un.org", "europa.eu",
    "worldbank.org", "imf.org", "nasa.gov", "nature.com", "science.org",
    "thelancet.com", "nejm.org", "gov.uk", "whitehouse.gov",
}

_JOURNALISM: set[str] = {
    "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "nytimes.com",
    "washingtonpost.com", "theguardian.com", "aljazeera.com",
    "france24.com", "npr.org", "pbs.org", "economist.com",
}

_MISINFO_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"naturalnews", re.I),
    re.compile(r"infowars", re.I),
    re.compile(r"beforeitsnews", re.I),
    re.compile(r"thegatewaypundit", re.I),
    re.compile(r"dailystormer", re.I),
]


def assess_source_credibility(url: str | None, content: str) -> int:
    """Return a credibility modifier (positive or negative integer).

    +20  highly reputable institutional source
    +12  recognised journalism outlet
    -10  unknown blog / social post
    -25  known misinformation patterns
    """
    text = (url or "") + " " + content[:2000]
    text_lower = text.lower()

    # Check misinformation first (strongest signal)
    for pat in _MISINFO_PATTERNS:
        if pat.search(text_lower):
            return -25

    # Check institutional
    for domain in _INSTITUTIONAL:
        if domain in text_lower:
            return 20

    # Check journalism
    for domain in _JOURNALISM:
        if domain in text_lower:
            return 12

    # If a URL was provided but didn't match anything → unknown source
    if url:
        return -10

    # No URL at all → can't determine
    return -5


def assess_evidence_quality(claims_raw: list[dict]) -> int:  # noqa: ARG001
    """Heuristic evidence quality modifier.

    This is intentionally conservative — without an external fact-checking API
    we cannot truly measure corroboration.  The LLM verification step already
    provides per-claim confidence; this function adds a global modifier.

    +15  multiple independent corroborations (approximated by avg confidence > 0.8)
     -8  single weak reference (avg confidence < 0.4)
    -12  no evidence at all (no claims or all unverified)
    """
    if not claims_raw:
        return -12

    confidences = [float(c.get("confidence", 0.5)) for c in claims_raw]
    avg = sum(confidences) / len(confidences) if confidences else 0.5

    unverified = sum(1 for c in claims_raw if str(c.get("verdict", "")).upper() == "UNVERIFIED")
    if unverified == len(claims_raw):
        return -12

    if avg >= 0.8:
        return 15
    elif avg >= 0.6:
        return 5
    elif avg >= 0.4:
        return 0
    else:
        return -8
