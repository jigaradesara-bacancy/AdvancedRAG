import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Cache } from '../models/index.js';
import { sha256 } from '../utils/text.js';
import { fetchWithRetry } from './llm.service.js';

/** Shortens a Matryoshka-style vector to the configured size and re-normalises it. */
export function fitDimensions(vector, dims) {
  if (vector.length === dims) return vector;
  if (vector.length < dims) throw new AppError(`Embedding model returned ${vector.length} dimensions but EMBEDDING_DIMENSIONS is ${dims}`, 500, 'EMBEDDING_DIMENSION_MISMATCH');
  const cut = vector.slice(0, dims);
  const norm = Math.sqrt(cut.reduce((a, v) => a + v * v, 0)) || 1;
  return cut.map((v) => v / norm);
}

async function callEmbeddings(inputs, kind) {
  const voyage = env.EMBEDDING_PROVIDER === 'voyage';
  if (env.EMBEDDING_PROVIDER !== 'ollama' && !env.EMBEDDING_API_KEY) {
    const hint = env.EMBEDDING_PROVIDER === 'gemini' ? 'GEMINI_API_KEY (free key from Google AI Studio)' : env.EMBEDDING_PROVIDER === 'voyage' ? 'VOYAGE_API_KEY' : 'EMBEDDING_API_KEY';
    throw new AppError(`${hint} is not configured`, 503, 'EMBEDDINGS_NOT_CONFIGURED');
  }
  const prefix = kind === 'query' ? env.EMBEDDING_QUERY_PREFIX : env.EMBEDDING_DOCUMENT_PREFIX;
  const res = await fetchWithRetry(`${env.EMBEDDING_BASE_URL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
    body: JSON.stringify({
      model: env.EMBEDDING_MODEL,
      input: inputs.map((t) => `${prefix}${t}`),
      ...(voyage ? { input_type: kind, output_dimension: env.EMBEDDING_DIMENSIONS } : {}),
    }),
  }, { label: `${env.EMBEDDING_PROVIDER} embeddings` });
  const body = await res.json();
  const rows = [...body.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return {
    vectors: rows.map((r) => fitDimensions(r.embedding, env.EMBEDDING_DIMENSIONS)),
    tokens: body.usage?.total_tokens ?? body.usage?.prompt_tokens ?? 0,
  };
}

/**
 * Embeds texts in batches. Vectors are cached by (provider, model, dimensions, text hash) so
 * re-indexing unchanged content costs nothing.
 */
export async function embedDocuments(texts, { onUsage } = {}) {
  const keyOf = (t) => `emb:${env.EMBEDDING_PROVIDER}:${env.EMBEDDING_MODEL}:${env.EMBEDDING_DIMENSIONS}:${sha256(t)}`;
  const keys = texts.map(keyOf);
  const cached = new Map((await Cache.find({ key: { $in: keys } }).lean()).map((c) => [c.key, c.value]));
  const out = new Array(texts.length);
  const missing = [];
  texts.forEach((t, i) => (cached.has(keys[i]) ? (out[i] = cached.get(keys[i])) : missing.push(i)));

  for (let i = 0; i < missing.length; i += env.EMBEDDING_BATCH_SIZE) {
    const idx = missing.slice(i, i + env.EMBEDDING_BATCH_SIZE);
    const { vectors, tokens } = await callEmbeddings(idx.map((j) => texts[j]), 'document');
    onUsage?.({ embeddingTokens: tokens, costUsd: (tokens * env.EMBEDDING_PRICE_PER_MTOK) / 1e6 });
    await Cache.bulkWrite(idx.map((j, k) => {
      out[j] = vectors[k];
      return { updateOne: { filter: { key: keys[j] }, update: { $set: { value: vectors[k] } }, upsert: true } };
    }));
  }
  logger.debug({ total: texts.length, embedded: missing.length }, 'embeddings done');
  return out;
}

export async function embedQuery(text) {
  const { vectors } = await callEmbeddings([text], 'query');
  return vectors[0];
}
