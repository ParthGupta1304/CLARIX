"""Step 1 — Content Summary."""

from __future__ import annotations

import logging

from prompts.system_prompt import SUMMARY_PROMPT
from services.llm_service import chat_completion_json

logger = logging.getLogger("clarix.engine.summarizer")


async def summarize(content: str) -> str:
    """Return a neutral 2-3 sentence summary of *content*."""
    data = await chat_completion_json(SUMMARY_PROMPT, content)
    summary = data.get("summary", "")
    if not summary:
        logger.warning("LLM returned empty summary; using fallback.")
        summary = "The content could not be summarized."
    return summary
