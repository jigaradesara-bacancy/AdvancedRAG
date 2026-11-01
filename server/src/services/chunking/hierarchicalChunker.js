import { countTokens } from '../../utils/text.js';
import { detectRegion } from '../../utils/regions.js';
import { makeChunk } from './common.js';
import { splitLongParagraph } from './paragraphChunker.js';

const PARENT_MAX_TOKENS = 2500;
const CHILD_TARGET = 300;
const CHILD_MAX = 450;

/**
 * Strategy B. Walks headings across the whole document and keeps a chapter / section / subsection
 * trail. Each section (and each boxed article, which gets its own scope) becomes a parent chunk;
 * paragraph groups inside it become children that point back at the parent. Region is inherited
 * from the nearest heading that names one, so regional text is never attributed to another region.
 */
export function hierarchicalChunker(doc, pages) {
  const chunks = [];
  const pageContext = new Map();
  let seq = 0;
  let chapterNumber = null;
  let chapter = null;
  let section = null;
  let subsection = null;
  let region = null;
  let box = null;
  let scope = null;

  const openScope = (page) => {
    const parent = makeChunk(doc, ++seq, {
      chunkType: 'parent',
      content: '(pending)',
      pageNumber: page,
      chapter, chapterNumber, section: box || section, subsection, region,
      sourceReference: `Page ${page}`,
      extractionMethod: 'pdf-structure',
    });
    scope = { parent, paras: [], page };
    chunks.push(parent);
  };

  const closeScope = () => {
    if (!scope) return;
    const { parent, paras } = scope;
    if (!paras.length) {
      chunks.splice(chunks.indexOf(parent), 1);
      scope = null;
      return;
    }
    const full = paras.map((p) => p.text).join('\n\n');
    let parentText = full;
    if (countTokens(full) > PARENT_MAX_TOKENS) parentText = splitLongParagraph(full, PARENT_MAX_TOKENS)[0];
    parent.content = parentText;
    parent.tokenCount = countTokens(parentText);
    parent.pageEnd = paras[paras.length - 1].page;

    let buf = [];
    let tokens = 0;
    const flush = () => {
      if (!buf.length) return;
      const first = buf[0];
      chunks.push(makeChunk(doc, ++seq, {
        chunkType: 'child',
        content: buf.map((b) => b.text).join('\n\n'),
        pageNumber: first.page,
        pageEnd: buf[buf.length - 1].page,
        chapter: parent.chapter,
        chapterNumber: parent.chapterNumber,
        section: parent.section,
        subsection: first.subsection,
        region: first.region ?? parent.region,
        parentChunkId: parent.chunkId,
        sourceReference: `Page ${first.page}${parent.section ? `, ${parent.section}` : ''}`,
        extractionMethod: 'pdf-structure',
      }));
      buf = [];
      tokens = 0;
    };
    for (const p of paras) {
      const pieces = countTokens(p.text) > CHILD_MAX ? splitLongParagraph(p.text, CHILD_MAX) : [p.text];
      for (const text of pieces) {
        const t = countTokens(text);
        const crossesSubsection = buf.length && buf[0].subsection !== p.subsection;
        if (buf.length && (tokens + t > CHILD_TARGET || crossesSubsection)) flush();
        buf.push({ ...p, text });
        tokens += t;
      }
    }
    flush();
    scope = null;
  };

  const chapterLabel = (title) => (chapterNumber ? `Chapter ${chapterNumber}${title ? `: ${title}` : ''}` : title);

  for (const page of pages) {
    if (page.chapterNumber && page.chapterNumber !== chapterNumber) {
      closeScope();
      chapterNumber = page.chapterNumber;
      chapter = `Chapter ${chapterNumber}`;
      section = subsection = region = box = null;
    }
    for (const b of page.blocks || []) {
      if (b.type === 'heading') {
        if (b.isBox) {
          closeScope();
          box = b.text;
          subsection = null;
        } else if (b.level === 1) {
          closeScope();
          const explicit = b.text.match(/^chapter\s*(\d+)\b\s*[:.-]?\s*(.*)$/i);
          if (explicit) chapterNumber = Number(explicit[1]);
          chapter = explicit ? chapterLabel(explicit[2].trim() || null) : chapterLabel(b.text);
          section = subsection = box = region = null;
        } else if (b.level === 2) {
          closeScope();
          section = b.text;
          subsection = box = null;
          region = detectRegion(b.text) ?? (detectRegion(chapter) || null);
        } else {
          subsection = b.text;
          region = detectRegion(b.text) ?? region;
        }
        continue;
      }
      if (!scope) openScope(page.pageNumber);
      scope.paras.push({ text: b.text, page: page.pageNumber, subsection, region });
    }
    pageContext.set(page.pageNumber, { chapter, chapterNumber, section: box || section, subsection, region, parentChunkId: scope?.parent.chunkId });
  }
  closeScope();
  return { chunks, pageContext };
}
