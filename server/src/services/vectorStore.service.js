import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Chunk } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { cosine } from '../utils/text.js';

let backend = null;
const FILTER_FIELDS = ['documentId', 'chunkType', 'chapter', 'chapterNumber', 'section', 'region', 'elementType', 'pageNumber'];

export const currentBackend = () => backend || 'unknown';

/** Creates the Atlas vector index when the server supports it; otherwise switches to the local scan. */
export async function ensureVectorIndex() {
  if (env.VECTOR_BACKEND === 'local') return (backend = 'local');
  try {
    const coll = Chunk.collection;
    const existing = await coll.listSearchIndexes(env.VECTOR_INDEX_NAME).toArray();
    if (!existing.length) {
      await coll.createSearchIndex({
        name: env.VECTOR_INDEX_NAME,
        type: 'vectorSearch',
        definition: {
          fields: [
            { type: 'vector', path: 'embedding', numDimensions: env.EMBEDDING_DIMENSIONS, similarity: 'cosine' },
            ...FILTER_FIELDS.map((path) => ({ type: 'filter', path })),
          ],
        },
      });
      logger.info('vector search index created');
    }
    backend = 'atlas';
  } catch (err) {
    if (env.VECTOR_BACKEND === 'atlas') throw err;
    logger.warn({ msg: err.message }, 'vector search unavailable, using exact local scan');
    backend = 'local';
  }
  return backend;
}

function toMongoFilter(filter = {}) {
  const f = {};
  for (const [k, v] of Object.entries(filter)) {
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    const value = k === 'documentId' ? (Array.isArray(v) ? v : [v]).map((id) => new mongoose.Types.ObjectId(String(id))) : v;
    f[k] = Array.isArray(value) ? { $in: value } : k === 'documentId' ? { $in: [value] } : value;
  }
  return f;
}

async function localSearch(vector, filter, limit) {
  const docs = await Chunk.find({ ...toMongoFilter(filter), embedding: { $exists: true } }, '+embedding').lean();
  return docs
    .map((d) => ({ ...d, score: cosine(vector, d.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ embedding, ...rest }) => rest);
}

export async function vectorSearch(vector, { filter, limit = env.RETRIEVAL_TOP_K } = {}) {
  if (!backend) await ensureVectorIndex();
  if (backend === 'atlas') {
    try {
      return await Chunk.aggregate([
        { $vectorSearch: { index: env.VECTOR_INDEX_NAME, path: 'embedding', queryVector: vector, numCandidates: Math.max(env.VECTOR_NUM_CANDIDATES, limit * 10), limit, filter: toMongoFilter(filter) } },
        { $addFields: { score: { $meta: 'vectorSearchScore' } } },
        { $project: { embedding: 0 } },
      ]);
    } catch (err) {
      // The index builds asynchronously after creation; serve exact results until it is queryable.
      logger.warn({ msg: err.message }, 'vectorSearch failed, falling back to local scan');
    }
  }
  return localSearch(vector, filter, limit);
}

export async function keywordSearch(query, { filter, limit = env.RETRIEVAL_TOP_K } = {}) {
  if (!query.trim()) return [];
  return Chunk.find({ ...toMongoFilter(filter), chunkType: { $ne: 'parent' }, $text: { $search: query } }, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();
}

export const getChunksByIds = (ids) => Chunk.find({ chunkId: { $in: ids } }).lean();
