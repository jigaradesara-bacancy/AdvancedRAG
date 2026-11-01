# 2. Free model providers behind an OpenAI-compatible client

Date: 2026-10-31
Status: accepted. Supersedes the Claude and Voyage choice in ADR 1.

## Context

The team has no paid Anthropic plan. ADR 1 assumed Claude for generation and vision and Voyage for embeddings, both paid.

## Decision

- Default to the Google Gemini free tier: `gemini-3.8-flash` for answers and vision, `gemini-embedding-001` for embeddings. One free key, no card.
- Offer Ollama as a fully local option (no key, no quota, private).
- Reach both through their OpenAI-compatible endpoints with one small fetch-based client. Ollama's current docs confirm streaming, base64 image input and embeddings on that API; Gemini's docs confirm the same. Any other OpenAI-compatible server then works by configuration.
- Keep Anthropic (SDK, loaded lazily) and Voyage as optional providers.
- Embedding size is fixed by `EMBEDDING_DIMENSIONS` (768). Longer vectors are truncated and re-normalised, which is valid for Matryoshka-trained models such as `gemini-embedding-001`; shorter ones raise an error.

## Alternatives considered

- Local-only embeddings in Node (transformers.js): no service to run, but slow startup and a second inference stack.
- Groq or OpenRouter free models: reachable through the same client, but free model lists change often, so they are left as configuration rather than defaults.

## Consequences

- Free-tier rate limits apply; every call retries on 429 and the pipeline resumes by stage.
- Gemini free-tier prompts may be used by Google. Confidential documents should use Ollama.
- Switching provider or embedding model requires reprocessing documents. The embedding cache key includes provider and model, so old vectors are not reused.
- Small or free models cite and read charts less reliably. The evidence validator stays on by default.
