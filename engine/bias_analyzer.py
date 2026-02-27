"""Step 4 — Bias & Manipulation Analysis."""

from __future__ import annotations

import logging
from typing import Any

from prompts.system_prompt import BIAS_ANALYSIS_PROMPT
from schemas.response import BiasSignal
from services.llm_service import chat_completion_json

logger = logging.getLogger("clarix.engine.bias_analyzer")


async def analyze_bias(content: str) -> list[BiasSignal]:
    """Detect bias or manipulation signals in *content*."""
    data = await chat_completion_json(BIAS_ANALYSIS_PROMPT, content)

    raw_signals: list[dict[str, Any]] = data.get("bias_signals", [])
    signals: list[BiasSignal] = []

    for item in raw_signals:
        try:
            signals.append(
                BiasSignal(
                    signal=str(item.get("signal", "Unknown")),
                    detail=str(item.get("detail", "")),
                )
            )
        except Exception:
            logger.exception("Failed to parse bias signal: %s", item)

    return signals
