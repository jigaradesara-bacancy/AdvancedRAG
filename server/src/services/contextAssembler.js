import { env } from '../config/env.js';
import { Chunk } from '../models/index.js';
import { countTokens } from '../utils/text.js';

const PARENT_EXCERPT_TOKENS = 500;

const shingles = (t) => new Set(t.toLowerCase().split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 20));

function overlaps(a, b) {
  if (!a.size || !b.size) return false;
  let shared = 0;
  a.forEach((s) => b.has(s) && shared++);
  return shared / Math.min(a.size, b.size) >= 0.8;
}

function label(c) {
  const where = [c.chapter, c.section, c.subsection].filter(Boolean).join(' > ');
  return [`Document: ${c.documentName}`, c.sourceReference || `Page ${c.pageNumber}`, c.elementType && `Element: ${c.elementType}`, where && `Section: ${where}`].filter(Boolean).join(' | ');
}

/**
 * Builds the prompt context. Duplicates are dropped, parent sections are added when the budget
 * allows, footnotes on the same page as a chart or table are pulled in, and sources are grouped by
 * document and ordered by page so the model reads them in document order.
 */
export async function assembleContext(chunks, { budgetTokens = env.LLM_CONTEXT_BUDGET_TOKENS } = {}) {
  const kept = [];
  const seenHash = new Set();
  const seenShingles = [];
  for (const c of chunks) {
    const sh = shingles(c.content);
    if (seenHash.has(c.contentHash) || seenShingles.some((o) => overlaps(sh, o))) continue;
    seenHash.add(c.contentHash);
    seenShingles.push(sh);
    kept.push(c);
  }

  const extras = [];
  const elementPages = [...new Set(kept.filter((c) => ['chart', 'table', 'icon', 'image'].includes(c.chunkType)).map((c) => `${c.documentId}:${c.pageNumber}`))];
  if (elementPages.length) {
    const found = await Chunk.find({ chunkType: 'footnote', $or: elementPages.map((k) => { const [d, p] = k.split(':'); return { documentId: d, pageNumber: Number(p) }; }) }).lean();
    found.filter((f) => !seenHash.has(f.contentHash)).forEach((f) => extras.push(f));
  }

  const parentIds = [...new Set(kept.slice(0, 3).map((c) => c.parentChunkId).filter(Boolean))];
  const parents = parentIds.length ? await Chunk.find({ chunkId: { $in: parentIds } }).lean() : [];

  let used = 0;
  const sources = [];
  const add = (c, extra = {}) => {
    const t = countTokens(c.content) + 30;
    if (used + t > budgetTokens) return false;
    used += t;
    sources.push({ ...c, ...extra });
    return true;
  };
  kept.forEach((c) => add(c));
  extras.forEach((c) => add(c));
  for (const p of parents) {
    const excerpt = p.content.split(/\s+/).slice(0, PARENT_EXCERPT_TOKENS).join(' ');
    if (!sources.some((s) => s.parentChunkId === p.chunkId && s.content.length >= p.content.length * 0.9)) {
      add({ ...p, content: excerpt, sourceReference: `${p.sourceReference} (section context)` }, { isParentContext: true });
    }
  }

  const ordered = [...sources].sort((a, b) => String(a.documentId).localeCompare(String(b.documentId)) || (a.pageNumber || 0) - (b.pageNumber || 0));
  ordered.forEach((s, i) => { s.sourceId = `S${i + 1}`; });
  const text = ordered.map((s) => `[${s.sourceId}] ${label(s)}\n${s.content}`).join('\n\n---\n\n');
  return { text, sources: ordered, tokens: used };
}
