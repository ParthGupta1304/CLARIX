-- ============================================
-- CLARIX — Supabase pgvector setup
-- Run this ONCE in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste → Run)
-- ============================================

-- 1. Enable the pgvector extension
create extension if not exists vector;

-- 2. Create the documents table
create table if not exists documents (
  id          bigserial primary key,
  doc_id      text unique not null,           -- application-level unique key (e.g. 'reuters-about')
  content     text not null,                  -- plain text (max ~2 000 chars stored by the app)
  metadata    jsonb default '{}'::jsonb,      -- arbitrary JSON (source, type, reliability …)
  embedding   vector(1536),                   -- OpenAI text-embedding-3-small produces 1 536 dims
  created_at  timestamptz default now()
);

-- 3. Create an IVFFlat index for fast similarity search
--    (lists = 100 is a good starting point for < 1 M rows)
create index if not exists documents_embedding_idx
  on documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. Create the RPC function used by the Node.js RAG service
create or replace function match_documents (
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count     int   default 5
)
returns table (
  id          bigint,
  doc_id      text,
  content     text,
  metadata    jsonb,
  similarity  float
)
language sql stable
as $$
  select
    d.id,
    d.doc_id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) as similarity
  from documents d
  where 1 - (d.embedding <=> query_embedding) > match_threshold
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
