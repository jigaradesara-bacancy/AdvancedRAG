import { layoutToLines, linesToParagraphs, isPageFurniture } from './pdfLoader.js';
import { normalizeHeader } from '../ingestion/analyzer.js';

export function stripRunningHeaders(lines, signals, layout) {
  const running = new Set(signals?.runningHeaders || []);
  return lines.filter((l) => !running.has(normalizeHeader(l.text)) && !/^\d{1,3}$/.test(l.text) && !(layout && isPageFurniture(l, layout, signals?.bodySize)));
}

/** Plain paragraph text in reading order, with page furniture removed. */
export class TextExtractor {
  name = 'text';
  async extractPage({ layout, signals }) {
    const lines = stripRunningHeaders(layoutToLines(layout), signals, layout);
    const paragraphs = linesToParagraphs(lines).map((p) => ({ type: 'paragraph', text: p.text }));
    return { paragraphs, text: paragraphs.map((p) => p.text).join('\n\n'), method: 'pdf-text' };
  }
}
