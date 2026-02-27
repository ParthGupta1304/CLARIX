# CLARIX Server

AI-powered news credibility scoring backend.

## Features

- **AI Credibility Scoring**: Score articles 0-100 with detailed analysis
- **Claim Extraction & Verification**: Extract and verify factual claims
- **RAG-based Fact Checking**: Retrieval-Augmented Generation for context
- **Swipeable Feed**: Personalized verified news feed
- **Browser Extension Support**: Public API key authentication
- **Cache-first Architecture**: Redis caching for performance

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis (optional, falls back to in-memory cache)

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

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `NODE_ENV` | Environment | development |
| `DATABASE_URL` | PostgreSQL connection string | - |
| `REDIS_URL` | Redis connection URL | redis://localhost:6379 |
| `JWT_SECRET` | JWT signing secret | - |
| `OPENAI_API_KEY` | OpenAI API key | - |
| `PUBLIC_API_KEY` | API key for browser extension | - |

## API Endpoints

### Analysis

#### POST /api/analyze/url
Analyze a URL for credibility.

```json
{
  "url": "https://example.com/article"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "credibility": {
      "score": 85,
      "confidence": 0.92,
      "category": "high",
      "label": "Highly Credible"
    },
    "analysis": {
      "explanation": "...",
      "summary": "..."
    },
    "claims": {
      "total": 5,
      "verified": 4
    }
  }
}
```

#### POST /api/analyze/text
Analyze raw text content.

```json
{
  "text": "Article content here...",
  "title": "Optional title"
}
```

### Feed

#### GET /api/feed
Get verified news feed.

Query params:
- `category`: Filter by category (default: all)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `personalized`: Use personalized feed (default: false)

#### POST /api/feedback/swipe
Record swipe feedback.

```json
{
  "feedItemId": "uuid",
  "direction": "RIGHT",
  "dwellTime": 5000
}
```

Direction values: `LEFT` (dismiss), `RIGHT` (save), `UP` (share), `DOWN` (report)

### Session

#### POST /api/session
Create anonymous session.

Returns JWT token for session authentication.

#### GET /api/session
Get current session info.

### Health

#### GET /api/health
Health check endpoint.

## Authentication

### Browser Extension
Use API key in header:
```
X-API-Key: your-api-key
```

### Web App
Use session token:
1. Create session: `POST /api/session`
2. Include token in header: `Authorization: Bearer <token>`

## Architecture

```
src/
├── config/          # Configuration
├── controllers/     # Route handlers
├── lib/             # Database & Redis clients
├── middleware/      # Auth, rate limiting, errors
├── queues/          # Bull queue workers
├── routes/          # API routes
├── services/        # Business logic
│   ├── cache.service.js
│   ├── content-parser.service.js
│   ├── credibility.service.js
│   ├── feed.service.js
│   ├── llm.service.js
│   └── rag.service.js
├── utils/           # Utilities
├── validators/      # Request validation
├── app.js           # Express app
└── index.js         # Entry point
```

## Database Schema

- **Articles**: Stores parsed article metadata
- **AnalysisResults**: Credibility scores and explanations
- **Claims**: Individual claim verifications
- **FeedItems**: Curated news feed
- **UserSessions**: Anonymous session tracking
- **SwipeFeedback**: Learning preferences

## Rate Limits

- General: 100 requests/minute per IP
- Analysis: 10 requests/minute (LLM expensive)
- Session creation: 10/hour per IP
- Feedback: 60 swipes/minute

## Edge Cases

- **Satire**: Marked as unverifiable with warning
- **Breaking News**: Low confidence flag
- **Opinion Pieces**: Tagged as opinion, not scored as news

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
