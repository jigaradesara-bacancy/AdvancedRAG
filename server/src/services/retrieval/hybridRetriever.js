import { env } from '../../config/env.js';
import { embedQuery } from '../embedding.service.js';
import { vectorSearch, keywordSearch } from '../vectorStore.service.js';
import { analyzeQuery } from './queryAnalyzer.js';
import { rerank } from './rerank.js';

const MIN_FILTERED = 3;

/** Reciprocal rank fusion over any number of ranked lists keyed by chunkId. */
export function fuse(lists, k = env.RRF_K) {
  const byId = new Map();
  lists.forEach((list, li) => {
    list.forEach((c, rank) => {
      const entry = byId.get(c.chunkId) || { ...c, fused: 0, sources: [] };
      entry.fused += 1 / (k + rank + 1);
      entry.sources.push(li === 0 ? 'vector' : 'keyword');
      if (li === 0) entry.vectorScore = c.score;
      else entry.textScore = c.score;
      byId.set(c.chunkId, entry);
    });
  });
  return [...byId.values()].sort((a, b) => b.fused - a.fused);
}

/**
 * When the question spans several documents but the evidence clearly belongs to one, keep only
 * that document so facts from different sources are not blended.
 */
export function isolateDominantDocument(ranked, documentIds) {
  if (documentIds?.length === 1 || ranked.length < 4) return ranked;
  const mass = new Map();
  ranked.slice(0, 6).forEach((c, i) => mass.set(String(c.documentId), (mass.get(String(c.documentId)) || 0) + 1 / (i + 1)));
  const total = [...mass.values()].reduce((a, b) => a + b, 0);
  const [topId, topMass] = [...mass.entries()].sort((a, b) => b[1] - a[1])[0];
  return topMass / total >= 0.7 ? ranked.filter((c) => String(c.documentId) === topId) : ranked;
}

export async function retrieve(question, { documentIds = [] } = {}) {
  const analysis = analyzeQuery(question);
  const vector = await embedQuery(analysis.expandedQuery);
  const base = { documentId: documentIds };
  const scoped = {
    ...base,
    ...(analysis.chapterNumber ? { chapterNumber: analysis.chapterNumber } : {}),
    ...(analysis.region ? { region: analysis.region } : {}),
  };
  const hasScope = scoped.chapterNumber || scoped.region;

  const run = (filter) => Promise.all([
    vectorSearch(vector, { filter, limit: env.RETRIEVAL_TOP_K }),
    keywordSearch(analysis.expandedQuery, { filter, limit: env.RETRIEVAL_TOP_K }),
  ]);
  let [vec, kw] = await run(hasScope ? scoped : base);
  let filterRelaxed = false;
  if (hasScope && vec.length + kw.length < MIN_FILTERED) {
    [vec, kw] = await run(base);
    filterRelaxed = true;
  }
  // Region-tagged chunks are only a hard filter when they exist; untagged chunks (tables, text outside
  // a regional section) are merged in through the unfiltered vector pass below.
  if (hasScope && !filterRelaxed) {
    const [extraVec] = await run(base);
    const seen = new Set(vec.map((c) => c.chunkId));
    vec = [...vec, ...extraVec.filter((c) => !seen.has(c.chunkId)).slice(0, 5)];
  }

  const fused = fuse([vec, kw]).slice(0, 30);
  const reranked = await rerank(fused, analysis);
  const isolated = isolateDominantDocument(reranked, documentIds);
  const picked = isolated.slice(0, env.FINAL_CONTEXT_CHUNKS);
  return {
    analysis, filterRelaxed, chunks: picked,
    stats: { vector: vec.length, keyword: kw.length, fused: fused.length, topVectorScore: vec[0]?.score ?? null },
  };
}
