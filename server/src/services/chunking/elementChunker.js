import { makeChunk } from './common.js';

const clean = (v) => (v == null || v === '' ? null : String(v));

function formatChart(e) {
  const lines = [`${e.elementType === 'diagram' ? 'Diagram' : 'Chart'}: ${e.title || 'Untitled'}`];
  if (e.description) lines.push(e.description);
  if (e.unit) lines.push(`Unit: ${e.unit}`);
  const cats = e.categories || [];
  for (const s of e.series || []) {
    const pairs = (s.values || []).map((v, i) => `${cats[i] ?? `#${i + 1}`}: ${v === null ? 'not stated' : v}`);
    lines.push(`Series${s.name ? ` "${s.name}"` : ''}: ${pairs.join('; ')}`);
  }
  return lines.join('\n');
}

function formatTable(e) {
  const cols = e.columns || [];
  const rows = e.rows || [];
  const head = [`Table: ${e.title || 'Untitled'}`];
  if (e.unit) head.push(`Unit: ${e.unit}`);
  if (e.description) head.push(e.description);
  const md = cols.length
    ? [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => c ?? '').join(' | ')} |`)].join('\n')
    : rows.map((r) => r.join(' | ')).join('\n');
  return `${head.join('\n')}\n${md}`;
}

function footnoteText(footnotes, markers) {
  const wanted = new Set((markers || []).map(String));
  return footnotes.filter((f) => wanted.has(String(f.marker))).map((f) => `[${f.marker}] ${f.text}`);
}

/**
 * Strategy C. One chunk per chart, table, icon claim and image, built from the structured
 * representation rather than raw text. Footnotes travel with the claims they qualify; footnotes
 * that qualify nothing in particular get their own chunk instead of being dropped.
 */
export function elementChunker(doc, elements, pageContext = new Map(), startSeq = 0) {
  const chunks = [];
  let seq = startSeq;
  for (const e of elements) {
    const ctx = pageContext.get(e.pageNumber) || {};
    const base = {
      pageNumber: e.pageNumber,
      elementType: e.elementType,
      elementId: String(e._id),
      sourceReference: e.sourceReference,
      extractionMethod: e.extractionMethod,
      chapter: ctx.chapter, chapterNumber: ctx.chapterNumber, section: ctx.section, subsection: ctx.subsection, region: ctx.region,
      parentChunkId: ctx.parentChunkId,
      data: { title: e.title, ...e.data },
    };
    const allNotes = e.footnotes || [];
    const usedMarkers = new Set();

    if (e.elementType === 'icon' && (e.data?.claims || []).length) {
      for (const claim of e.data.claims) {
        const notes = footnoteText(allNotes, claim.footnoteMarkers);
        (claim.footnoteMarkers || []).forEach((m) => usedMarkers.add(String(m)));
        const content = [
          `Claim${claim.component ? ` about ${claim.component}` : ''}: ${claim.text}`,
          clean(claim.value) && `Value: ${claim.value}`,
          notes.length && `Footnotes: ${notes.join(' ')}`,
        ].filter(Boolean).join('\n');
        chunks.push(makeChunk(doc, ++seq, { ...base, chunkType: 'icon', content, data: { ...base.data, claim } }));
      }
    } else {
      let content;
      if (e.elementType === 'chart' || e.elementType === 'diagram') content = formatChart({ ...e, ...e.data });
      else if (e.elementType === 'table') content = e.data?.markdown ? `Table: ${e.title || 'Untitled'}\n${e.data.markdown}` : formatTable({ ...e, ...e.data });
      else content = `${e.elementType}: ${e.title || ''}\n${e.description || ''}`;
      const notes = allNotes.map((f) => `[${f.marker}] ${f.text}`);
      allNotes.forEach((f) => usedMarkers.add(String(f.marker)));
      if (notes.length) content += `\nFootnotes: ${notes.join(' ')}`;
      const type = ['chart', 'table'].includes(e.elementType) ? e.elementType : e.elementType === 'diagram' ? 'chart' : 'image';
      chunks.push(makeChunk(doc, ++seq, { ...base, chunkType: type, content }));
    }

    for (const f of allNotes.filter((n) => !usedMarkers.has(String(n.marker)))) {
      chunks.push(makeChunk(doc, ++seq, {
        ...base, chunkType: 'footnote', elementType: 'footnote',
        content: `Footnote [${f.marker}]${f.appliesTo ? ` (applies to: ${f.appliesTo})` : ''}: ${f.text}`,
      }));
    }
  }
  return chunks;
}
