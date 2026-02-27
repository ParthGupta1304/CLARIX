"""Step 7 — User Guidance."""

from __future__ import annotations

import logging

from prompts.system_prompt import GUIDANCE_PROMPT
from schemas.response import ClaimAnalysis, BiasSignal
from services.llm_service import chat_completion_json

logger = logging.getLogger("clarix.engine.guidance")


async def generate_guidance(
    summary: str,
    claims: list[ClaimAnalysis],
    bias_signals: list[BiasSignal],
) -> list[str]:
    """Return 2-4 actionable suggestions to help the user verify the content."""
    context_parts = [
        f"Summary: {summary}",
        "Claims:",
        *[f"  - [{c.verdict.value}] {c.claim}" for c in claims],
        "Bias signals:",
        *[f"  - {s.signal}: {s.detail}" for s in bias_signals],
    ]
    user_msg = "\n".join(context_parts)

    data = await chat_completion_json(GUIDANCE_PROMPT, user_msg)
    suggestions: list[str] = data.get("suggestions", [])

    if not isinstance(suggestions, list):
        logger.warning("LLM returned non-list suggestions; defaulting.")
        return ["Verify claims using reputable news sources and official databases."]

    return [str(s) for s in suggestions[:4]]
