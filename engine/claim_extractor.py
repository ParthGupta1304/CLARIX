"""Step 2 — Claim Extraction."""

from __future__ import annotations

import logging

from config import settings
from prompts.system_prompt import CLAIM_EXTRACTION_PROMPT
from services.llm_service import chat_completion_json

logger = logging.getLogger("clarix.engine.claim_extractor")


async def extract_claims(content: str) -> list[str]:
    """Extract up to ``max_claims`` verifiable factual claims from *content*."""
    prompt = CLAIM_EXTRACTION_PROMPT.replace("{max_claims}", str(settings.max_claims))
    data = await chat_completion_json(prompt, content)
    claims: list[str] = data.get("claims", [])

    if not isinstance(claims, list):
        logger.warning("LLM returned non-list claims; coercing to empty.")
        return []

    # Deduplicate, trim whitespace, drop empty strings
    cleaned: list[str] = []
    seen: set[str] = set()
    for c in claims:
        s = str(c).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(s)

    return cleaned[: settings.max_claims]
