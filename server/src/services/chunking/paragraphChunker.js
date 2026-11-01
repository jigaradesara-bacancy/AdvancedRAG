import { countTokens, splitSentences } from '../../utils/text.js';
import { makeChunk } from './common.js';

export const PARAGRAPH_DEFAULTS = { targetTokens: 320, maxTokens: 480, minTokens: 60 };

/** Splits one over-long paragraph on sentence boundaries, repeating the last sentence as overlap. */
export function splitLongParagraph(text, maxTokens) {
  const sentences = splitSentences(text);
  const out = [];
  let cur = [];
  let tokens = 0;
  for (const s of sentences) {
    const t = countTokens(s);
    if (cur.length && tokens + t > maxTokens) {
      out.push(cur.join(' '));
      cur = [cur[cur.length - 1]];
      tokens = countTokens(cur[0]);
    }
    cur.push(s);
    tokens += t;
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/**
 * Strategy A. Paragraphs are packed into chunks of roughly targetTokens inside a single page, so
 * a page reference is always exact. A sentence is never cut in half and a paragraph is only split
 * when it alone exceeds maxTokens.
 */
export function paragraphChunker(doc, pages, opts = {}) {
  const { targetTokens, maxTokens, minTokens } = { ...PARAGRAPH_DEFAULTS, ...opts };
  const chunks = [];
  let seq = 0;
  for (const page of pages) {
    const paras = (page.paragraphs || []).map((p) => p.text).filter((t) => t.length > 0);
    const pageChunks = [];
    let buf = [];
    let tokens = 0;
    const flush = () => {
      if (buf.length) pageChunks.push(buf.join('\n\n'));
      buf = [];
      tokens = 0;
    };
    for (const text of paras) {
      const t = countTokens(text);
      if (t > maxTokens) {
        flush();
        splitLongParagraph(text, maxTokens).forEach((piece) => pageChunks.push(piece));
        continue;
      }
      if (buf.length && tokens + t > targetTokens) flush();
      buf.push(text);
      tokens += t;
    }
    flush();
    for (let i = pageChunks.length - 1; i > 0; i--) {
      if (countTokens(pageChunks[i]) < minTokens) {
        pageChunks[i - 1] += `\n\n${pageChunks[i]}`;
        pageChunks.splice(i, 1);
      }
    }
    for (const content of pageChunks) {
      chunks.push(makeChunk(doc, ++seq, {
        chunkType: page.extractors?.includes('ocr') ? 'ocr' : 'paragraph',
        content,
        pageNumber: page.pageNumber,
        sourceReference: `Page ${page.pageNumber}`,
        extractionMethod: page.method,
      }));
    }
  }
  return { chunks, pageContext: new Map() };
}
