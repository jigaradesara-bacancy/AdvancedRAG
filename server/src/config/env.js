import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const schema = z.object({
  PORT: z.coerce.number().default(5050),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  MONGODB_URI: z.string().default('mongodb://localhost:27017/?directConnection=true'),
  MONGODB_DB_NAME: z.string().default('advanced_rag'),
  VECTOR_BACKEND: z.enum(['auto', 'atlas', 'local']).default('auto'),
  VECTOR_INDEX_NAME: z.string().default('chunk_embedding_index'),
  VECTOR_NUM_CANDIDATES: z.coerce.number().default(200),

  LLM_PROVIDER: z.enum(['gemini', 'ollama', 'anthropic', 'openai-compatible']).default('gemini'),
  LLM_BASE_URL: z.string().default(''),
  LLM_API_KEY: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  LLM_ANSWER_MODEL: z.string().default(''),
  LLM_VISION_MODEL: z.string().default(''),
  LLM_FALLBACK_MODELS: z.string().optional(),
  LLM_MAX_TOKENS: z.coerce.number().default(1500),
  LLM_CONTEXT_BUDGET_TOKENS: z.coerce.number().optional(),
  LLM_TIMEOUT_MS: z.coerce.number().default(120000),
  LLM_IDLE_TIMEOUT_MS: z.coerce.number().default(60000),
  LLM_REASONING_EFFORT: z.string().optional(),
  LLM_INPUT_PRICE_PER_MTOK: z.coerce.number().default(0),
  LLM_OUTPUT_PRICE_PER_MTOK: z.coerce.number().default(0),

  EMBEDDING_PROVIDER: z.enum(['gemini', 'ollama', 'voyage', 'openai-compatible']).default('gemini'),
  EMBEDDING_BASE_URL: z.string().default(''),
  EMBEDDING_API_KEY: z.string().default(''),
  VOYAGE_API_KEY: z.string().default(''),
  EMBEDDING_MODEL: z.string().default(''),
  EMBEDDING_DIMENSIONS: z.coerce.number().optional(),
  EMBEDDING_BATCH_SIZE: z.coerce.number().optional(),
  EMBEDDING_QUERY_PREFIX: z.string().optional(),
  EMBEDDING_DOCUMENT_PREFIX: z.string().optional(),
  EMBEDDING_PRICE_PER_MTOK: z.coerce.number().default(0),

  RETRIEVAL_TOP_K: z.coerce.number().default(20),
  FINAL_CONTEXT_CHUNKS: z.coerce.number().default(8),
  RRF_K: z.coerce.number().default(60),
  RERANK_PROVIDER: z.enum(['heuristic', 'llm']).default('heuristic'),

  DOCUMENTS_DIR: z.string().default('../data/documents'),
  UPLOAD_MAX_SIZE_MB: z.coerce.number().default(100),
  PROCESSING_VERSION: z.coerce.number().default(1),
  MIN_PAGE_TEXT_CHARS: z.coerce.number().default(80),
  VISION_RENDER_SCALE: z.coerce.number().default(2),
  VISION_MAX_PAGES: z.coerce.number().default(40),
  OCR_LANG: z.string().default('eng'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const LLM_PRESETS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', answer: 'gemini-3.8-flash', vision: 'gemini-3.8-flash', fallbacks: 'gemini-3.6-flash,gemini-3.5-flash-lite', reasoning: 'low', budget: 24000 },
  ollama: { baseUrl: 'http://localhost:11434/v1', answer: 'rag-qwen', vision: 'gemma3:4b', budget: 6000 },
  anthropic: { baseUrl: '', answer: 'claude-sonnet-5-5', vision: 'claude-sonnet-5-5', budget: 24000 },
  'openai-compatible': { baseUrl: '', answer: '', vision: '', budget: 12000 },
};
const EMBEDDING_PRESETS = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-embedding-001', dimensions: 768, batch: 32, queryPrefix: '', documentPrefix: '' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'nomic-embed-text', dimensions: 768, batch: 16, queryPrefix: 'search_query: ', documentPrefix: 'search_document: ' },
  voyage: { baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-3.5', dimensions: 1024, batch: 64, queryPrefix: '', documentPrefix: '' },
  'openai-compatible': { baseUrl: '', model: '', dimensions: 768, batch: 32, queryPrefix: '', documentPrefix: '' },
};

const d = parsed.data;
const lp = LLM_PRESETS[d.LLM_PROVIDER];
const ep = EMBEDDING_PRESETS[d.EMBEDDING_PROVIDER];
const keyFor = (provider, explicit) => explicit || ({ gemini: d.GEMINI_API_KEY, anthropic: d.ANTHROPIC_API_KEY, voyage: d.VOYAGE_API_KEY, ollama: 'ollama' })[provider] || '';

/** Provider presets fill every unset LLM_* and EMBEDDING_* value, so a provider switch is one or two variables. */
export const env = {
  ...d,
  LLM_BASE_URL: d.LLM_BASE_URL || lp.baseUrl,
  LLM_API_KEY: keyFor(d.LLM_PROVIDER, d.LLM_API_KEY),
  LLM_ANSWER_MODEL: d.LLM_ANSWER_MODEL || lp.answer,
  LLM_VISION_MODEL: d.LLM_VISION_MODEL || lp.vision,
  LLM_CONTEXT_BUDGET_TOKENS: d.LLM_CONTEXT_BUDGET_TOKENS ?? lp.budget,
  LLM_REASONING_EFFORT: d.LLM_REASONING_EFFORT ?? lp.reasoning ?? '',
  LLM_FALLBACK_MODELS: (d.LLM_FALLBACK_MODELS ?? lp.fallbacks ?? '').split(',').map((m) => m.trim()).filter(Boolean),
  EMBEDDING_BASE_URL: d.EMBEDDING_BASE_URL || ep.baseUrl,
  EMBEDDING_API_KEY: keyFor(d.EMBEDDING_PROVIDER, d.EMBEDDING_API_KEY),
  EMBEDDING_MODEL: d.EMBEDDING_MODEL || ep.model,
  EMBEDDING_DIMENSIONS: d.EMBEDDING_DIMENSIONS ?? ep.dimensions,
  EMBEDDING_BATCH_SIZE: d.EMBEDDING_BATCH_SIZE ?? ep.batch,
  EMBEDDING_QUERY_PREFIX: d.EMBEDDING_QUERY_PREFIX ?? ep.queryPrefix,
  EMBEDDING_DOCUMENT_PREFIX: d.EMBEDDING_DOCUMENT_PREFIX ?? ep.documentPrefix,
};
export const paths = {
  serverRoot,
  documentsDir: path.resolve(serverRoot, env.DOCUMENTS_DIR),
  uploadsDir: path.resolve(serverRoot, 'storage/uploads'),
  pageImagesDir: path.resolve(serverRoot, 'storage/page-images'),
};
