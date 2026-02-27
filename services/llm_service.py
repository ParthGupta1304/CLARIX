"""Thin wrapper around LLM providers (OpenAI / Azure / local-compatible)."""

from __future__ import annotations

import json
import logging
from typing import Any

from openai import AsyncOpenAI, AsyncAzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from config import settings

logger = logging.getLogger("clarix.llm")


def _build_client() -> tuple[AsyncOpenAI, str]:
    """Return (async_client, model_name) based on the configured provider."""
    provider = settings.llm_provider.lower()

    if provider == "azure":
        client = AsyncAzureOpenAI(
            azure_endpoint=settings.azure_openai_endpoint,
            api_key=settings.azure_openai_api_key,
            api_version="2024-12-01-preview",
        )
        model = settings.azure_openai_deployment
    elif provider == "local":
        client = AsyncOpenAI(
            base_url=settings.local_llm_base_url,
            api_key="not-needed",
        )
        model = settings.local_llm_model
    else:  # default: openai
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        model = settings.openai_model

    return client, model


_client, _model = _build_client()


class LLMError(Exception):
    """Raised when the LLM call fails after retries."""


@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=30),
    retry=retry_if_exception_type(Exception),
    reraise=True,
)
async def chat_completion(
    system_prompt: str,
    user_message: str,
    *,
    temperature: float | None = None,
    response_format: dict[str, Any] | None = None,
) -> str:
    """Send a chat-completion request and return the assistant's text reply.

    Parameters
    ----------
    system_prompt : str
        The system-level instruction.
    user_message : str
        The user-level content to analyse.
    temperature : float, optional
        Sampling temperature; defaults to ``settings.verification_temperature``.
    response_format : dict, optional
        If supplied, passed as ``response_format`` to the API (e.g. JSON mode).

    Returns
    -------
    str
        Raw text content of the assistant reply.
    """
    temp = temperature if temperature is not None else settings.verification_temperature

    kwargs: dict[str, Any] = {
        "model": _model,
        "temperature": temp,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
    }
    if response_format is not None:
        kwargs["response_format"] = response_format

    try:
        response = await _client.chat.completions.create(**kwargs)
        content = response.choices[0].message.content
        if content is None:
            raise LLMError("LLM returned empty content.")
        return content.strip()
    except Exception as exc:
        logger.exception("LLM call failed: %s", exc)
        raise


async def chat_completion_json(
    system_prompt: str,
    user_message: str,
    *,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Like ``chat_completion`` but forces JSON output and parses it."""
    raw = await chat_completion(
        system_prompt,
        user_message,
        temperature=temperature,
        response_format={"type": "json_object"},
    )
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse LLM JSON: %s\nRaw: %s", exc, raw[:500])
        raise LLMError(f"LLM returned invalid JSON: {exc}") from exc
