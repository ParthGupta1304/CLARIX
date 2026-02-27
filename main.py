"""Clarix — Evidence-based News Verification Engine.

FastAPI application entry-point.
Designed to run as an internal service consumed by the Node.js Express backend.
"""

from __future__ import annotations

import logging
import secrets
import sys
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from engine.pipeline import run_pipeline
from schemas.request import VerifyRequest
from schemas.response import ErrorResponse, VerifyResponse

# ── Logging ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s | %(name)-30s | %(levelname)-7s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("clarix")


# ── Internal-token auth dependency ─────────────────────────────────────

async def verify_internal_token(
    x_internal_token: str | None = Header(default=None),
) -> None:
    """Reject requests that don't carry the shared internal token.

    Skipped when ``INTERNAL_TOKEN`` is not configured (dev mode).
    """
    expected = settings.internal_token
    if not expected:
        return  # no token configured → open access (dev only)
    if not x_internal_token or not secrets.compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="Invalid or missing internal token.")


# ── Lifespan ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    logger.info(
        "Clarix pipeline starting — provider=%s model=%s auth=%s",
        settings.llm_provider,
        settings.openai_model,
        "enabled" if settings.internal_token else "disabled (dev)",
    )
    yield
    logger.info("Clarix pipeline shutting down.")


# ── App ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Clarix",
    description="Evidence-based news verification engine — internal service for the Node.js backend.",
    version="0.2.0",
    lifespan=lifespan,
)

# Parse allowed_origins (comma-separated string → list)
_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "engine": "clarix", "version": "0.2.0"}


@app.post(
    "/verify",
    response_model=VerifyResponse,
    responses={401: {"model": ErrorResponse}, 422: {"model": ErrorResponse}, 500: {"model": ErrorResponse}},
    summary="Verify content credibility",
    description="Accepts raw text and returns a structured credibility assessment. "
    "Intended to be called by the Node.js Express server.",
    dependencies=[Depends(verify_internal_token)],
)
async def verify(payload: VerifyRequest) -> VerifyResponse:
    try:
        result = await run_pipeline(
            payload.content,
            url=payload.url,
            title=payload.title,
            content_type=payload.content_type,
            request_id=payload.request_id,
        )
        return result
    except Exception as exc:
        logger.exception("Pipeline failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# ── Dev runner ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=True,
    )
