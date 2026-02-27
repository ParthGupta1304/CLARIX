"""Step 3 — Claim Verification."""

from __future__ import annotations

import logging
from typing import Any

from prompts.system_prompt import CLAIM_VERIFICATION_PROMPT
from schemas.response import ClaimAnalysis, ClaimVerdict
from services.llm_service import chat_completion_json

logger = logging.getLogger("clarix.engine.claim_verifier")


def _parse_verdict(raw: str) -> ClaimVerdict:
    """Normalise the LLM's verdict string into a ``ClaimVerdict`` enum."""
    raw_upper = raw.strip().upper()
    for v in ClaimVerdict:
        if v.value == raw_upper:
            return v
    logger.warning("Unrecognised verdict '%s'; defaulting to UNVERIFIED.", raw)
    return ClaimVerdict.UNVERIFIED


def _safe_confidence(val: Any) -> float:
    try:
        f = float(val)
        return max(0.0, min(1.0, f))
    except (TypeError, ValueError):
        return 0.5


async def verify_claims(claims: list[str]) -> list[ClaimAnalysis]:
    """Verify each claim and return structured ``ClaimAnalysis`` objects."""
    if not claims:
        return []

    user_msg = "Claims to verify:\n" + "\n".join(f"- {c}" for c in claims)
    data = await chat_completion_json(CLAIM_VERIFICATION_PROMPT, user_msg)

    results: list[dict[str, Any]] = data.get("results", [])
    analyses: list[ClaimAnalysis] = []

    for item in results:
        try:
            analyses.append(
                ClaimAnalysis(
                    claim=str(item.get("claim", "")),
                    verdict=_parse_verdict(str(item.get("verdict", "UNVERIFIED"))),
                    confidence=_safe_confidence(item.get("confidence", 0.5)),
                    reason=str(item.get("reason", "No reason provided.")),
                    credible_sources=[str(s) for s in item.get("credible_sources", [])],
                )
            )
        except Exception:
            logger.exception("Failed to parse claim result: %s", item)

    return analyses
