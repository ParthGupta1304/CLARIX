# Clarix — Evidence-Based News Verification Engine

A Python + FastAPI backend that powers a browser extension for real-time credibility assessment of online content.

## Architecture

```
pipeline/
├── main.py                  # FastAPI app entry-point
├── config.py                # Settings from .env
├── requirements.txt
├── .env.example
│
├── schemas/                 # Pydantic request / response models
│   ├── request.py
│   └── response.py
│
├── services/                # External integrations
│   └── llm_service.py       # OpenAI / Azure / local LLM wrapper
│
├── prompts/                 # System prompts per pipeline stage
│   └── system_prompt.py
│
├── engine/                  # Core verification pipeline
│   ├── pipeline.py          # Orchestrator (7-step chain)
│   ├── summarizer.py        # Step 1 — Content Summary
│   ├── claim_extractor.py   # Step 2 — Claim Extraction
│   ├── claim_verifier.py    # Step 3 — Claim Verification
│   ├── bias_analyzer.py     # Step 4 — Bias & Manipulation
│   ├── scorer.py            # Step 5 — Numerical Scoring
│   ├── verdict.py           # Step 6 — Verdict Categorisation
│   ├── guidance.py          # Step 7 — User Guidance
│   └── heuristics.py        # Source credibility & evidence quality
│
└── tests/
    ├── test_engine.py       # Deterministic unit tests
    └── test_api.py          # API integration tests (mocked LLM)
```

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — at minimum set OPENAI_API_KEY
```

### 3. Run the server

```bash
python main.py
# → http://localhost:8000
```

Or with uvicorn directly:

```bash
uvicorn main:app --reload
```

### 4. Call the API

```bash
curl -X POST http://localhost:8000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Breaking: Scientists discover water on Mars surface...",
    "url": "https://example.com/article"
  }'
```

### 5. Run tests

```bash
pytest tests/ -v
```

## API Endpoints

| Method | Path      | Description                        |
|--------|-----------|------------------------------------|
| GET    | `/health` | Health check                       |
| POST   | `/verify` | Run the 7-step verification pipeline |

### POST `/verify`

**Request body:**

| Field          | Type     | Required | Description                        |
|----------------|----------|----------|------------------------------------|
| `content`      | string   | ✅       | Raw text (1–50,000 chars)          |
| `url`          | string   | ❌       | Source URL for credibility scoring  |
| `content_type` | string   | ❌       | Hint: article, social_post, etc.   |

**Response:**

```json
{
  "summary": "...",
  "claims": [
    {
      "claim": "...",
      "verdict": "SUPPORTED | CONTRADICTED | UNVERIFIED",
      "confidence": 0.85,
      "reason": "...",
      "credible_sources": ["WHO", "CDC"]
    }
  ],
  "bias_signals": [
    { "signal": "Loaded language", "detail": "..." }
  ],
  "authenticity_score": 72,
  "verdict": "QUESTIONABLE / NEEDS FACT CHECK",
  "reasoning": "...",
  "how_to_verify": ["Check WHO reports.", "..."],
  "disclaimer": "This credibility assessment is AI-generated and should not replace independent verification."
}
```

## Scoring Formula

| Factor                      | Modifier |
|-----------------------------|----------|
| Base                        | 50       |
| Each SUPPORTED claim        | +12      |
| Each CONTRADICTED claim     | −18      |
| Each UNVERIFIED claim       | −5       |
| Institutional source        | +20      |
| Journalism outlet           | +12      |
| Unknown blog/social         | −10      |
| Known misinformation        | −25      |
| Multiple corroborations     | +15      |
| Single weak reference       | −8       |
| No evidence                 | −12      |
| Heavy sensationalism        | −10      |
| Context omission            | −8       |
| Misleading visuals          | −12      |

Score clamped to **0–100**.

| Score   | Verdict                       |
|---------|-------------------------------|
| 85–100  | VERIFIED / HIGHLY RELIABLE    |
| 65–84   | QUESTIONABLE / NEEDS FACT CHECK |
| 0–64    | MISLEADING OR LIKELY FALSE    |

## LLM Providers

Set `LLM_PROVIDER` in `.env`:

| Value   | Backend                     |
|---------|-----------------------------|
| `openai` | OpenAI API (default)       |
| `azure`  | Azure OpenAI               |
| `local`  | Ollama or any OpenAI-compat |

## License

MIT
