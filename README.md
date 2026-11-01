# Advanced RAG

One document question-answering system for three kinds of PDF: plain business reports, long structured reports, and visually complex documents with charts, tables, icons and footnotes. There is one pipeline. What changes per document is the extractor, chunker and retrieval bias, chosen from measured properties of the PDF and never from its file name.

## Quick start

Requirements: Node 20.19+ (22 recommended), Docker, and a free Gemini API key from https://aistudio.google.com/apikey (no card, no paid plan). Prefer to keep everything on your machine? See "Fully local with Ollama" below.

```bash
npm install
# create server/.env from .env.example and set GEMINI_API_KEY
npm run db:up                    # MongoDB with Atlas Vector Search (docker)
cp your-reports/*.pdf data/documents/   # optional; or upload through the UI
npm run dev                      # API on :5050, UI on :5173
```

Open http://localhost:5173. PDFs in `data/documents/` are registered at startup and when you press "Scan data directory". Without Docker, set `VECTOR_BACKEND=local` and any `mongod` works; vector search then falls back to an exact in-process cosine scan (fine for a handful of documents).

## Environment variables

All are in [.env.example](.env.example) with defaults. `LLM_PROVIDER` (`gemini`, `ollama`, `anthropic`, `openai-compatible`) and `EMBEDDING_PROVIDER` (`gemini`, `ollama`, `voyage`, `openai-compatible`) pick the backends; every URL, model and dimension then defaults from that choice. Models are configured only through `LLM_ANSWER_MODEL`, `LLM_VISION_MODEL` and `EMBEDDING_MODEL`. `EMBEDDING_DIMENSIONS` must match the vector index; changing provider or model means deleting the index and reprocessing (the cache is keyed by provider and model, so nothing stale is reused). Cost figures use the `*_PRICE_PER_MTOK` values and show $0 on free tiers.

### Free model options

| | Gemini free tier (default) | Ollama (local) |
|---|---|---|
| Key | free key from AI Studio | none |
| Chat and vision | `gemini-3.8-flash` | `rag-qwen` (see below) and `gemma3:4b` for vision |
| Embeddings | `gemini-embedding-001`, 768 dims | `nomic-embed-text`, 768 dims |
| Limits | rate limits; queue retries on 429 automatically | your CPU/RAM; slow without a GPU |
| Privacy | free-tier prompts may be used by Google | nothing leaves the machine |
| Answer quality | best of the free options | noticeably weaker on charts and long contexts |

If the main model is overloaded (503), rate limited (429) or retired (404), the client tries `LLM_FALLBACK_MODELS` in turn (Gemini defaults to two other free Flash models). Unknown model names are skipped with a log warning, so correct the list from AI Studio when Google renames models.

Provider layer: Gemini and Ollama are both called through their OpenAI-compatible endpoints by one client (`services/llm.service.js`, `embedding.service.js`), so any other OpenAI-compatible server (Groq, OpenRouter, LM Studio) works with `openai-compatible` plus `LLM_BASE_URL`, `LLM_API_KEY` and model names. Anthropic and Voyage remain available if you get keys later.

### Fully local with Ollama

```bash
brew install ollama && ollama serve        # or the desktop app
ollama pull qwen2.5:7b
ollama pull gemma3:4b                      # vision, for charts and tables
ollama pull nomic-embed-text               # embeddings
# Ollama's OpenAI endpoint cannot set the context window; the default (a few thousand tokens) would silently truncate sources.
printf 'FROM qwen2.5:7b\nPARAMETER num_ctx 8192\n' | ollama create rag-qwen -f -
```

Then set `LLM_PROVIDER=ollama` and `EMBEDDING_PROVIDER=ollama` and set `FINAL_CONTEXT_CHUNKS=5`. The context budget defaults to 6000 tokens for Ollama. Expect minutes, not seconds, per vision page on CPU; lower `VISION_MAX_PAGES` for large PDFs.

## Architecture

```
Upload / data dir -> validate (PDF signature, sha256 dedupe) -> job queue (resumable stages)
  analyze   per-page signals: text volume, images, vector drawing ops, font-size hierarchy, running headers
  classify  plain | structured | visual | scanned | mixed, plus a per-page extractor plan (user override allowed)
  extract   Text | Structured | Table | OCR | Visual (vision-model) extractors, any mix per page
  chunk     Paragraph | Hierarchical | Element chunkers behind one interface
  embed     embeddings, batched, cached by content hash
  store     MongoDB: documents, pages, chunks (+ vector index), visualElements, conversations

Question -> query analysis (region, chapter, intent) -> vector + full-text search with metadata filters
  -> reciprocal rank fusion -> rerank -> dominant-document isolation -> context assembly
  -> LLM (streamed) -> evidence validation -> answer with citations
```

Code map (all under `server/src`):

| Concern | Location |
|---|---|
| PDF reading, layout, rendering | `services/extraction/pdfLoader.js` |
| Extractors (common `extractPage(ctx)` interface) | `services/extraction/*Extractor.js`, registry in `index.js` |
| Analysis and classification | `services/ingestion/analyzer.js`, `classifier.js` |
| Stage runner, resume, cost tracking | `services/ingestion/pipeline.js`, `jobRunner.js` |
| Chunkers | `services/chunking/` |
| Embeddings, vector store | `services/embedding.service.js`, `services/vectorStore.service.js` |
| Retrieval | `services/retrieval/` |
| Context, generation, validation | `services/contextAssembler.js`, `answerGeneration.service.js`, `rag.service.js` |
| Evaluation | `services/evaluation/`, cases in `evaluation/cases.json` |

### How the three use cases map onto it

| | Plain report | Long structured report | Visual PDF |
|---|---|---|---|
| Signals | little graphics, flat font sizes | 40+ pages, headings on at least 18% of prose pages | graphics-heavy pages with little text |
| Extractors | text | structured + table | text + table + vision |
| Chunker | paragraph (sentence-safe, about 320 tokens, page-exact) | hierarchical (section parents, paragraph children, boxed articles scoped separately) | element (one chunk per chart, table, icon claim; footnotes attached) |
| Retrieval bias | exact numbers via full-text leg | region and chapter filters, parent expansion | chart/table/footnote boost |

Mixed PDFs use several extractors in one document. Element chunks are added to any document that produced visual elements, whatever its text strategy.

### Data model

- `documents`: file, sha256, classification (type, confidence, signals, page plan), strategy override, status, stage, progress, completed stages, processing version, usage and cost.
- `pages`: per-page text, paragraphs/blocks, extractors used, rendered image path.
- `chunks`: content, embedding, documentId/Name/Type, pageNumber, chunkId, chunkType, chapter, chapterNumber, section, subsection, region, parentChunkId, elementType, sourceReference, extractionMethod, original structured `data`.
- `visualelements`: charts, tables, icons, images, footnotes as structured data with `sourceReference`, footnote links and number validation against the page text layer.
- `conversations`: questions, answers, citations, validation result, usage.

### Ingestion workflow

Upload returns `202` immediately. A single in-process worker runs `analyze, extract, chunk, embed`. Each stage is recorded, and extraction skips pages already stored, so a failed or interrupted run resumes where it stopped (the UI shows "Resume"). Documents left mid-run by a crash are re-queued at startup. "Reprocess" wipes derived data; Embeddings and vision results are cached by content hash, so re-indexing unchanged pages costs nothing. Bump `PROCESSING_VERSION` after changing extraction or chunking logic and reprocess; documents on an older version are re-indexed from scratch when processed.

### Retrieval workflow

1. Rule-based query analysis (no model call): region, chapter number, section hints, numeric and visual intent, light query expansion.
2. Vector search (`$vectorSearch` or local scan) and `$text` search, both filtered by selected documents and, when the question names one, region or chapter. If a filter leaves fewer than 3 hits it is relaxed.
3. Reciprocal rank fusion, then heuristic rerank (keyword coverage, metadata agreement, element-type preference, penalty for other regions). `RERANK_PROVIDER=llm` adds a model rerank (one extra call per question).
4. If the evidence clearly belongs to one document, the others are dropped.
5. Context assembly: de-duplication, parent section excerpts, footnotes on the same page as a chart or table, document and page ordering, token budget.
6. Generation under a grounding prompt, then validation: every `[S#]` must exist and every number must appear in the sources unless labelled as a calculation. Failures are shown in the UI, not hidden.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/documents/upload` | multipart field `file`; `202`, `409` on duplicate |
| POST | `/api/documents/scan` | registers PDFs in `DOCUMENTS_DIR` |
| GET | `/api/documents`, `/api/documents/:id` | list, detail |
| DELETE | `/api/documents/:id` | removes file, pages, chunks, elements |
| POST | `/api/documents/:id/process` | body `{force, strategyOverride}` |
| GET | `/api/documents/:id/status` | stage, progress, usage |
| GET | `/api/documents/:id/extraction`, `chunks`, `structure`, `visual-elements` | inspection; `chunks` takes `type`, `q`, `page`, `limit` |
| GET | `/api/documents/:id/pages/:n/image`, `/file` | rendered page, original PDF |
| POST | `/api/chat` | `{question, documentIds[], conversationId?}` |
| POST | `/api/chat/stream` | SSE events `sources`, `token`, `done`, `error` |
| GET | `/api/chat/history` | list, or `?id=` for one conversation |
| GET | `/api/sources/:id` | a chunk by `chunkId` or `_id` |
| GET/POST | `/api/evaluation/cases`, `runs`, `run` | evaluation |
| GET | `/api/stats`, `/api/health` | dashboard numbers |

Errors use `{ error: { code, message, details? } }`.

## Testing and evaluation

```bash
npm test                 # unit tests (no network, no database)
npm run evaluate         # runs server/evaluation/cases.json against processed documents
```

`cases.json` contains the nine example questions plus one unanswerable control question. Expected facts, expected pages and expected visual elements are left empty on purpose: fill them after reading your PDFs. Cases with no expectations are reported as unscored. Metrics: Precision@K and Recall@K (against expected pages), answer correctness (expected facts, numbers compared by value), faithfulness (evidence validator), citation correctness, region/chapter isolation, visual extraction accuracy, correct document, and refusal handling.

## Known limitations

- No live model call has been made. Ingestion, chunking, classification, retrieval wiring, the REST API and the UI were run against real PDFs with stubbed embeddings. The provider layer (chat, streaming, vision payloads, retry on 429, embedding resize) is covered by mocked-fetch unit tests only. Run one document of each type and the evaluation before relying on it.
- Free and small models are weaker than frontier models, especially at reading charts and at following the "cite every claim" rule. The evidence validator exists to catch this: expect more flagged answers, and check the visual extraction tab against the rendered page.
- Gemini free-tier rate limits can make a 200-page document take a while to embed; the pipeline retries and resumes, and cached batches are not re-sent.
- Table extraction from text positions is heuristic. Tables drawn with lines or images depend on the vision extractor, which only runs on pages the classifier marks visual and within `VISION_MAX_PAGES`.
- Chart values are only as reliable as the labels printed on the chart. Values the model reads that do not appear in the page's text layer are flagged `unverified`; bar heights are never estimated.
- Heading detection uses font size and font changes. Narrow-column boxes and pull quotes can produce odd section names (the Structure tab shows exactly what was detected).
- Region tagging uses a fixed vocabulary in `utils/regions.js` (World Bank regions). Add entries for other entity types.
- The job queue is in-process, single worker. Use a real queue to run more than one API instance.
- Token counts use a GPT-style tokenizer as an approximation for budgeting only; billed usage comes from the APIs.
