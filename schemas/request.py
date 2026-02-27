"""Request schemas for the Clarix API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class VerifyRequest(BaseModel):
    """Payload sent by the Node.js server or browser extension."""

    content: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Raw text extracted from the user's screen (article, post, caption, OCR, transcript, etc.).",
    )
    title: str | None = Field(
        default=None,
        description="Title of the article, if available.",
    )
    url: str | None = Field(
        default=None,
        description="Source URL of the content, if available.",
    )
    content_type: str | None = Field(
        default=None,
        alias="contentType",
        description="Content type hint: news, opinion, satire, breaking, social_post, caption, transcript, headline, ocr.",
    )
    source_type: str | None = Field(
        default=None,
        alias="sourceType",
        description="Origin of the request: extension, web, internal.",
    )
    request_id: str | None = Field(
        default=None,
        alias="requestId",
        description="Caller's request ID for tracing.",
    )

    model_config = {"populate_by_name": True}


class PredictRequest(BaseModel):
    """Payload for the HuggingFace fake news detection endpoint."""

    text: str = Field(
        ...,
        min_length=1,
        max_length=50_000,
        description="Text content to classify as REAL or FAKE.",
    )
