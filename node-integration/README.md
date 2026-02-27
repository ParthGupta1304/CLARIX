# Node.js Integration Guide

These files are **drop-in TypeScript modules** for wiring your existing
Node.js Express server to the Clarix Python engine.

## Files

| File                        | Where to place in your server      | Purpose                                        |
|-----------------------------|------------------------------------|-------------------------------------------------|
| `clarixEngineClient.ts`    | `src/services/`                    | HTTP client — calls Python `/verify` endpoint   |
| `analysisMapper.ts`        | `src/mappers/`                     | Maps Clarix output → your existing API contract |
| `analyzeRoutes.ts`         | `src/routes/`                      | Express route wiring (replace inline LLM calls) |
| `analysisQueueWorker.ts`   | `src/workers/` or `src/queues/`    | Bull queue processor using Clarix engine        |

## Setup Steps

### 1. Copy files into your Express project

```bash
cp clarixEngineClient.ts   ../your-server/src/services/
cp analysisMapper.ts       ../your-server/src/mappers/
cp analyzeRoutes.ts        ../your-server/src/routes/
cp analysisQueueWorker.ts  ../your-server/src/workers/
```

### 2. Install axios (if not already)

```bash
npm install axios
```

### 3. Add env vars to your Node `.env`

```dotenv
# Clarix Python engine
CLARIX_ENGINE_URL=http://127.0.0.1:8000
CLARIX_INTERNAL_TOKEN=<same value as INTERNAL_TOKEN in Python .env>
```

### 4. Generate a shared token

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Put the output in both:
- Python's `.env` → `INTERNAL_TOKEN=<token>`
- Node's `.env` → `CLARIX_INTERNAL_TOKEN=<token>`

### 5. Start the Python engine

```bash
cd pipeline/
python main.py
# → http://127.0.0.1:8000
```

### 6. Start your Node server

```bash
cd your-server/
npm run dev
# → http://localhost:3000
```

### 7. Wire routes (in your Express app)

```ts
// In your Express app.ts or server.ts
import analyzeRoutes from "./routes/analyzeRoutes";
app.use("/api/analyze", analyzeRoutes);
```

## What gets replaced

| Before (inline in Node)          | After (Clarix engine)                          |
|----------------------------------|-------------------------------------------------|
| `extractClaims()` (LLM call)    | Handled by Python `engine/claim_extractor.py`   |
| `verifyClaims()` (LLM call)     | Handled by Python `engine/claim_verifier.py`    |
| `analyzeCredibility()` (LLM)    | Full 7-step pipeline in Python                  |
| `generateEmbedding()` (RAG)     | Keep in Node (or move later)                    |
| RAG retrieve/store               | Keep in Node (or move later)                    |

## What stays in Node

- URL normalisation + SHA-256 hashing
- Redis cache lookup/store
- HTML parsing (Cheerio)
- JWT / API key authentication
- Rate limiting
- Bull queue orchestration
- Prisma DB persistence
- Feed personalisation / swipe scoring
- Session management

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Browser Ext /   │────▶│  Node.js Express     │────▶│  Python Clarix  │
│ Web App         │     │  (port 3000)         │     │  (port 8000)    │
│                 │◀────│                      │◀────│                 │
│ X-API-Key / JWT │     │  Auth, Cache, Queue, │     │  7-step verify  │
└─────────────────┘     │  DB, Feed, Sessions  │     │  pipeline       │
                        └──────────────────────┘     └─────────────────┘
```
