# 1. Stack, vector store and embeddings

Date: 2026-10-31
Status: accepted

## Context

The system must index three document types in one pipeline, with hybrid search and metadata filtering. The repo was empty. Sibling projects use Node, Express, Mongoose and MongoDB, and Docker is installed locally.

## Decision

- Node/Express backend, React/Vite frontend, plain JavaScript (matches the sibling projects).
- MongoDB Atlas Vector Search through the `mongodb-atlas-local` image for development. The same `$vectorSearch` code runs on Atlas. When the server has no vector search, the store falls back to an exact in-process cosine scan so a plain `mongod` still works.
- Full-text search uses MongoDB `$text`, so one database holds vectors, text and metadata and filters apply to both.
- Embeddings from Voyage AI (`voyage-3.5`, 1024 dimensions), called over REST. Claude has no embeddings endpoint, and Voyage is the provider Anthropic recommends.
- Claude for answers and for vision extraction. Models are set only in environment variables.
- PDF reading with `pdfjs-dist` and page rendering with `@napi-rs/canvas`, so no system binaries (poppler) are needed. OCR uses `tesseract.js` for the same reason.

## Alternatives considered

- ChromaDB (used by a sibling project): another service to run, and metadata filtering and text search would live in two places.
- OpenAI embeddings: works, but adds a third vendor for no quality gain we measured. Local embeddings: no key needed but lower retrieval quality.
- `pdf-parse`: loses coordinates and font sizes, which heading and table detection depend on.

## Consequences

- Changing the embedding model or dimensions requires dropping the vector index and reprocessing.
- The local scan is O(chunks) per query; use Atlas or the Docker image beyond a few thousand chunks.
