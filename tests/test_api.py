"""Tests for the FastAPI routes (mocked LLM)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# Ensure auth is disabled for tests (no INTERNAL_TOKEN set)
import os
os.environ.pop("INTERNAL_TOKEN", None)

from main import app


client = TestClient(app)


def _mock_chat_json(prompt: str, msg: str, **kw):  # noqa: ARG001
    """Return canned JSON objects depending on which prompt is calling."""
    if "SUMMARY" in prompt:
        return {"summary": "Test summary of the content."}
    if "EXTRACTION" in prompt:
        return {"claims": ["Claim A is true.", "Claim B happened in 2024."]}
    if "VERIFICATION" in prompt:
        return {
            "results": [
                {
                    "claim": "Claim A is true.",
                    "verdict": "SUPPORTED",
                    "confidence": 0.85,
                    "reason": "Well-documented fact.",
                    "credible_sources": ["WHO"],
                },
                {
                    "claim": "Claim B happened in 2024.",
                    "verdict": "UNVERIFIED",
                    "confidence": 0.4,
                    "reason": "No corroboration found.",
                    "credible_sources": [],
                },
            ]
        }
    if "BIAS" in prompt:
        return {"bias_signals": [{"signal": "Loaded language", "detail": "Emotionally charged adjectives."}]}
    if "GUIDANCE" in prompt:
        return {"suggestions": ["Check WHO reports.", "Search official press releases."]}
    return {}


@pytest.fixture(autouse=True)
def _patch_llm():
    targets = [
        "engine.summarizer.chat_completion_json",
        "engine.claim_extractor.chat_completion_json",
        "engine.claim_verifier.chat_completion_json",
        "engine.bias_analyzer.chat_completion_json",
        "engine.guidance.chat_completion_json",
    ]
    patches = [patch(t, new_callable=AsyncMock, side_effect=_mock_chat_json) for t in targets]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


class TestHealthEndpoint:
    def test_health(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["version"] == "0.2.0"


class TestVerifyEndpoint:
    def test_successful_verification(self):
        resp = client.post("/verify", json={"content": "Some news article text about world events."})
        assert resp.status_code == 200
        data = resp.json()
        assert "summary" in data
        assert "claims" in data
        assert "authenticity_score" in data
        assert 0 <= data["authenticity_score"] <= 100
        assert data["verdict"] in [
            "VERIFIED / HIGHLY RELIABLE",
            "QUESTIONABLE / NEEDS FACT CHECK",
            "MISLEADING OR LIKELY FALSE",
        ]
        assert data["disclaimer"].startswith("This credibility assessment")

    def test_empty_content_rejected(self):
        resp = client.post("/verify", json={"content": ""})
        assert resp.status_code == 422

    def test_optional_url(self):
        resp = client.post(
            "/verify",
            json={"content": "Article text.", "url": "https://bbc.com/article/123"},
        )
        assert resp.status_code == 200

    def test_node_compatible_fields_present(self):
        """The response must include all fields the Node.js mapper expects."""
        resp = client.post("/verify", json={"content": "Test article content."})
        assert resp.status_code == 200
        data = resp.json()

        # Node-server-compatible fields
        assert "overall_confidence" in data
        assert 0.0 <= data["overall_confidence"] <= 1.0
        assert data["category"] in ["high", "good", "mixed", "low", "very-low"]
        assert data["label"] != ""
        assert data["color"] in ["green", "yellow", "red"]
        assert data["source_quality"] in ["institutional", "journalism", "unknown", "misinfo"]
        assert isinstance(data["positive_signals"], list)
        assert isinstance(data["negative_signals"], list)

    def test_camel_case_aliases_accepted(self):
        """Node server sends camelCase field names — Python should accept them."""
        resp = client.post(
            "/verify",
            json={
                "content": "Article text.",
                "contentType": "news",
                "sourceType": "web",
                "requestId": "req-abc-123",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["request_id"] == "req-abc-123"

    def test_title_field_accepted(self):
        resp = client.post(
            "/verify",
            json={
                "content": "Body text of the article.",
                "title": "Breaking News: Something Happened",
            },
        )
        assert resp.status_code == 200

    def test_content_type_adjustment(self):
        """Satire content type should reduce score."""
        resp_news = client.post(
            "/verify",
            json={"content": "Article text.", "contentType": "news"},
        )
        resp_satire = client.post(
            "/verify",
            json={"content": "Article text.", "contentType": "satire"},
        )
        assert resp_news.status_code == 200
        assert resp_satire.status_code == 200
        # Satire adjustment should lower the score
        assert resp_satire.json()["authenticity_score"] <= resp_news.json()["authenticity_score"]


class TestInternalAuth:
    def test_no_auth_when_token_not_configured(self):
        """With empty INTERNAL_TOKEN, all requests should pass."""
        resp = client.post("/verify", json={"content": "Test content."})
        assert resp.status_code == 200

    def test_auth_rejects_bad_token_when_configured(self):
        """When INTERNAL_TOKEN is set, wrong token → 401."""
        from config import settings
        original = settings.internal_token
        try:
            settings.internal_token = "super-secret-token"
            resp = client.post(
                "/verify",
                json={"content": "Test content."},
                headers={"X-Internal-Token": "wrong-token"},
            )
            assert resp.status_code == 401
        finally:
            settings.internal_token = original

    def test_auth_accepts_correct_token_when_configured(self):
        from config import settings
        original = settings.internal_token
        try:
            settings.internal_token = "super-secret-token"
            resp = client.post(
                "/verify",
                json={"content": "Test content."},
                headers={"X-Internal-Token": "super-secret-token"},
            )
            assert resp.status_code == 200
        finally:
            settings.internal_token = original

    def test_auth_rejects_missing_token_when_configured(self):
        from config import settings
        original = settings.internal_token
        try:
            settings.internal_token = "super-secret-token"
            resp = client.post(
                "/verify",
                json={"content": "Test content."},
            )
            assert resp.status_code == 401
        finally:
            settings.internal_token = original
