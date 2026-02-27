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
from schemas.request import VerifyRequest, PredictRequest
from schemas.response import ErrorResponse, VerifyResponse, PredictResponse

# ── Logging ────────────────────────────────────────────────────────────

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s | %(name)-30s | %(levelname)-7s | %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("clarix")


# ── HuggingFace fake news model ────────────────────────────────────────

_hf_tokenizer = None
_hf_model = None
HF_MODEL_PATH = "yashvasudeva/text-based-fake-news-detector"


def _load_hf_model():
    """Load the HuggingFace model. Called once at startup."""
    global _hf_tokenizer, _hf_model
    import torch
    from transformers import AutoTokenizer, AutoModelForSequenceClassification

    logger.info("Loading HuggingFace model: %s", HF_MODEL_PATH)
    _hf_tokenizer = AutoTokenizer.from_pretrained(HF_MODEL_PATH)
    _hf_model = AutoModelForSequenceClassification.from_pretrained(HF_MODEL_PATH)
    _hf_model.eval()
    logger.info("HuggingFace model loaded successfully.")


def _predict_fake_news(text: str) -> dict:
    """Run inference with the HuggingFace fake news detector."""
    import torch

    inputs = _hf_tokenizer(
        text,
        return_tensors="pt",
        truncation=True,
        padding=True,
        max_length=256,
    )
    with torch.no_grad():
        logits = _hf_model(**inputs).logits

    probs = torch.softmax(logits, dim=1).squeeze().numpy()
    return {
        "label": "FAKE" if probs[1] > probs[0] else "REAL",
        "confidence": round(float(max(probs)) * 100, 2),
        "real_probability": round(float(probs[0]) * 100, 2),
        "fake_probability": round(float(probs[1]) * 100, 2),
    }


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
    # Load HuggingFace model at startup
    try:
        _load_hf_model()
    except Exception as exc:
        logger.warning("HuggingFace model failed to load — /predict will be unavailable: %s", exc)
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
    return {
        "status": "ok",
        "engine": "clarix",
        "version": "0.2.0",
        "hf_model_loaded": _hf_model is not None,
    }


@app.post(
    "/predict",
    response_model=PredictResponse,
    summary="Fake news prediction via HuggingFace model",
    description="Runs the yashvasudeva/text-based-fake-news-detector model "
    "and returns FAKE/REAL label with confidence scores.",
)
async def predict(payload: PredictRequest) -> PredictResponse:
    if _hf_model is None or _hf_tokenizer is None:
        raise HTTPException(status_code=503, detail="HuggingFace model not loaded")
    try:
        result = _predict_fake_news(payload.text)
        return PredictResponse(**result)
    except Exception as exc:
        logger.exception("Predict failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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
