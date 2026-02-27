# CLARIX Server

AI-powered news credibility scoring backend for the CLARIX platform — a system that detects fake news using AI agents and a verification layer (LLM + RAG) to flag news as **Authorized**, **Suspicious**, or **Flagged**.

## Credibility Scoring System

| Score Range | Category | Badge | Extension Action | Feed Card |
|-------------|----------|-------|------------------|-----------|
| 90–100% | **Authorized** | Blue `#3B82F6` | Blue badge | Blue "Verified" |
| 60–89% | **Suspicious** | Red `#EF4444` | Red badge + warning | Red "Unverified" |
| 0–59% | **Flagged** | Grey `#6B7280` | White overlay/strikethrough | **Hidden** |

## Features

- **AI Credibility Scoring**: Score articles 0-100 with LLM-powered analysis
- **Claim Extraction & Verification**: Extract factual claims and verify via RAG
- **3-Tier Classification**: Authorized / Suspicious / Flagged
- **Browser Extension API**: Badge colors, overlays, and warning messages
- **Swipeable Feed**: Flashcard reader with blue (verified) / red (unverified) cards
- **Preference Learning**: Swipe behavior learns categories (politics, tech, etc.)
- **Async Analysis**: Queue-based non-blocking analysis with polling
- **Cache-first Architecture**: Redis caching with in-memory fallback

## Quick Start

### Prerequisites

- Node.js 18+
- SQLite (development) / PostgreSQL (production)
- Redis (optional — falls back to in-memory cache)

### Installation

```bash
# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Generate Prisma client
npm run db:generate

# Push schema to database
npm run db:push

# Start development server
npm run dev
```

## API Endpoints

### Analysis

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/analyze/url` | Required | Analyze URL for credibility (sync) |
| `POST` | `/api/analyze/text` | Required | Analyze raw text (sync) |
| `POST` | `/api/analyze/async/url` | Required | Queue URL analysis (async, returns job ID) |
| `GET` | `/api/analyze/status/:requestId` | Public | Poll async analysis status |
| `GET` | `/api/analyze/:resultId` | Public | Get specific analysis result |
| `GET` | `/api/analyze/history` | Session | Get session analysis history |

#### POST /api/analyze/url — Response

```json
{
  "success": true,
  "data": {
    "resultId": "uuid",
    "title": "Article Title",
    "source": "example.com",
    "credibility": {
      "score": 92,
      "confidence": 0.95,
      "category": "authorized",
      "color": "#3B82F6",
      "label": "Authorized",
      "badge": "VERIFIED"
    },
    "extension": {
      "action": "show_blue_badge",
      "badgeText": "92%",
      "badgeColor": "#3B82F6",
      "showOverlay": false,
      "showWarning": false,
      "overlayMessage": null,
      "warningMessage": null
    },
    "analysis": {
      "explanation": "Detailed explanation...",
      "summary": "2-3 sentence summary",
      "sourceQuality": 0.9,
      "biasIndicator": "CENTER",
      "signals": { "positive": [...], "negative": [...] },
      "recommendations": [...]
    },
    "claims": {
      "total": 5,
      "verified": 4,
      "details": [...]
    }
  }
}
```

### Feed

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/feed` | Public | Get feed items (cards) |
| `GET` | `/api/feed/categories` | Public | Available feed categories |
| `GET` | `/api/feed/preferences` | Session | Get learned preferences |
| `GET` | `/api/feed/:itemId` | Public | Get single feed item |

Query params for `GET /api/feed`:
- `category` — Filter by category (default: `all`)
- `page` — Page number (default: `1`)
- `limit` — Items per page (default: `20`, max: `50`)
- `minScore` — Minimum credibility score (default: `60`)
- `personalized` — Use preference-based ordering (default: `false`)

### Feedback

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/feedback/swipe` | Session | Record swipe feedback |

Swipe directions: `LEFT` (dismiss), `RIGHT` (save), `UP` (share), `DOWN` (report)

### Session

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/session` | Public | Create anonymous session (returns JWT) |
| `GET` | `/api/session` | Session | Get session info |
| `PUT` | `/api/session/activity` | Session | Update activity timestamp |
| `DELETE` | `/api/session` | Session | Delete session |

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/admin/stats` | API Key | System stats (queues, DB counts) |
| `POST` | `/api/admin/feed/refresh` | API Key | Trigger manual feed refresh |

### Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | Public | Health check |

## Authentication

### Browser Extension
```
X-API-Key: your-api-key
```

### Web App
1. `POST /api/session` → get JWT token
2. `Authorization: Bearer <token>`

## Architecture

```
src/
├── config/          # Centralized configuration + scoring thresholds
├── controllers/     # Route handlers (analyze, feed, session)
├── lib/             # Prisma client + Redis client
├── middleware/       # Auth (JWT + API key), rate limiting, error handling
├── queues/          # Bull queue (lazy init) + workers
├── routes/          # API routes (analyze, feed, feedback, session, admin)
├── services/        # Business logic
│   ├── cache.service.js          # Redis/in-memory cache
│   ├── content-parser.service.js # URL fetch + Cheerio parsing
│   ├── credibility.service.js    # Core analysis pipeline + scoring
│   ├── feed.service.js           # Flashcard feed + preference learning
│   ├── llm.service.js            # OpenAI integration
│   └── rag.service.js            # RAG retrieval (in-memory MVP)
├── utils/           # Winston logger
├── validators/      # Zod request validation
├── app.js           # Express app setup
└── index.js         # Server bootstrap
```

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| General API | 100 req | 1 minute |
| Analysis (POST) | 10 req | 1 minute |
| Session creation | 10 req | 1 hour |
| Swipe feedback | 60 req | 1 minute |

## Environment Variables

See [.env.example](.env.example) for all required variables.

## Scripts

```bash
npm start          # Production start
npm run dev        # Development with hot reload
npm run db:generate # Generate Prisma client
npm run db:push    # Push schema to database
npm run db:migrate # Run migrations
npm run db:studio  # Open Prisma Studio
```

## License

Proprietary
