import { env } from '../../config/env.js';
import { completeJson } from '../llm.service.js';

const VISUAL_TYPES = new Set(['chart', 'table', 'icon', 'footnote', 'image']);

function coverage(content, kws) {
  if (!kws.length) return 0;
  const text = content.toLowerCase();
  return kws.filter((k) => text.includes(k)).length / kws.length;
}

/**
 * Heuristic rerank on top of RRF: keyword coverage, exact-token hits, metadata agreement with the
 * query, element-type preference for visual questions, and a strong penalty for chunks that
 * belong to a different region than the one asked about.
 */
export function heuristicRerank(candidates, analysis) {
  const maxFused = Math.max(...candidates.map((c) => c.fused), 1e-9);
  return candidates
    .map((c) => {
      let score = c.fused / maxFused;
      score += 0.6 * coverage(c.content, analysis.keywords);
      const meta = `${c.chapter || ''} ${c.section || ''} ${c.subsection || ''}`.toLowerCase();
      score += 0.25 * coverage(meta, analysis.keywords);
      if (analysis.wantsNumber && /\d/.test(c.content)) score += 0.1;
      if (analysis.wantsVisual && VISUAL_TYPES.has(c.chunkType)) score += 0.3;
      if (analysis.region) {
        if (c.region === analysis.region) score += 0.5;
        else if (c.region) score *= 0.3;
      }
      if (analysis.chapterNumber && c.chapterNumber === analysis.chapterNumber) score += 0.4;
      if (analysis.sectionHint && meta.includes(analysis.sectionHint)) score += 0.5;
      return { ...c, rerankScore: score };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}

export async function llmRerank(candidates, analysis) {
  const top = candidates.slice(0, 20);
  const listing = top.map((c, i) => `[${i}] (${c.sourceReference}) ${c.content.slice(0, 350)}`).join('\n');
  const { json } = await completeJson({
    model: env.LLM_ANSWER_MODEL,
    maxTokens: 400,
    system: 'Rank passages by how directly they answer the question. Return JSON {"order":[indices, best first]}. Include only passages that help.',
    content: `Question: ${analysis.question}\n\nPassages:\n${listing}`,
  });
  const order = (json.order || []).filter((i) => top[i]);
  const picked = new Set(order);
  return [...order.map((i) => ({ ...top[i], rerankScore: 1 - order.indexOf(i) * 0.01 })), ...top.filter((_, i) => !picked.has(i))];
}

export async function rerank(candidates, analysis) {
  const base = heuristicRerank(candidates, analysis);
  if (env.RERANK_PROVIDER === 'llm') {
    try {
      return await llmRerank(base, analysis);
    } catch {
      return base;
    }
  }
  return base;
}
