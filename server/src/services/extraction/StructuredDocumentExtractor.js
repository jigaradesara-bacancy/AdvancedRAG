import { layoutToLines, linesToParagraphs, isPageFurniture } from './pdfLoader.js';
import { normalizeHeader } from '../ingestion/analyzer.js';

const CAPTION = /^(figure|table|box|annex table|spotlight)\s+[\w.]+/i;
const BOX = /^box\s+[\w.]+/i;
const CHAPTER_MARK = /^chapter\s?(\d+)$/i;

const despace = (t) => (/^(?:\S ){3,}\S/.test(t) ? t.replace(/(?<=\S) (?=\S)/g, '') : t);

/**
 * Splits a page into headings, captions and paragraphs. Heading levels come from the document's
 * measured font-size ranks, so any PDF with a consistent typographic hierarchy works.
 */
export class StructuredDocumentExtractor {
  name = 'structured';

  levelOf(line, signals, bodyFont, layout) {
    const sizes = signals?.headingSizes || [];
    const body = signals?.bodySize || 10;
    const idx = sizes.findIndex((s) => Math.abs(s - line.size) <= 0.6);
    if (idx >= 0 && line.text.length < 160) return idx + 1;
    if (line.size >= body * 1.15 && line.text.length < 120) return Math.min(sizes.length + 1, 4);
    if (line.bold && line.size >= body - 0.5 && line.text.length < 90 && !/[.:;,]$/.test(line.text) && line.text.split(' ').length <= 12) return Math.min(sizes.length + 1, 4);
    const words = line.text.split(' ').length;
    if (bodyFont && line.font !== bodyFont && line.size >= body - 0.5 && words <= 6 && !line.text.includes(',') && line.x1 - line.x0 < layout.width * 0.4 && line.text.length > 2 && !/[.,;:]$/.test(line.text) && /^[A-Z]/.test(line.text) && !CAPTION.test(line.text)) return Math.min(sizes.length + 1, 4);
    return 0;
  }

  async extractPage({ layout, signals }) {
    const running = new Set(signals?.runningHeaders || []);
    const raw = layoutToLines(layout);
    let chapterNumber = null;
    const lines = [];
    for (const l of raw) {
      if (running.has(normalizeHeader(l.text))) {
        for (const seg of l.segments) {
          const mark = despace(seg.text).match(CHAPTER_MARK);
          if (mark) chapterNumber = Number(mark[1]);
        }
        continue;
      }
      if (/^\d{1,3}$/.test(l.text) || isPageFurniture(l, layout, signals?.bodySize)) continue;
      lines.push(l);
    }
    const fontChars = new Map();
    lines.forEach((l) => fontChars.set(l.font, (fontChars.get(l.font) || 0) + l.text.length));
    const bodyFont = [...fontChars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

    const blocks = [];
    let buffer = [];
    const flush = () => {
      if (!buffer.length) return;
      for (const p of linesToParagraphs(buffer)) {
        blocks.push({ type: CAPTION.test(p.text) ? 'caption' : 'paragraph', text: p.text });
      }
      buffer = [];
    };
    for (const l of lines) {
      const level = this.levelOf(l, signals, bodyFont, layout);
      if (level > 0) {
        flush();
        const prev = blocks[blocks.length - 1];
        const sameHeading = prev?.type === 'heading' && prev.level === level && Math.abs(prev.size - l.size) < 0.6 && level <= (signals?.headingSizes?.length || 0) && prev.text.length < 100;
        if (sameHeading) prev.text += ` ${l.text}`;
        else blocks.push({ type: 'heading', level, text: l.text, size: l.size, isBox: BOX.test(l.text) });
      } else {
        buffer.push(l);
      }
    }
    flush();
    blocks.forEach((b) => delete b.size);
    return {
      blocks,
      paragraphs: blocks.filter((b) => b.type !== 'heading'),
      text: blocks.map((b) => (b.type === 'heading' ? `${'#'.repeat(b.level)} ${b.text}` : b.text)).join('\n\n'),
      chapterNumber,
      method: 'pdf-structure',
    };
  }
}
