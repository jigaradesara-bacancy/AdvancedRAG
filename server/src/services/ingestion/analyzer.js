import { env } from '../../config/env.js';
import { openPdf, getPageLayout, layoutToLines, countGraphics } from '../extraction/pdfLoader.js';

const NUMERIC = /^[\d.,%$()\-–+]+$/;

/** Collapses letter-spaced text ("C H A P T E R 1") and digits so running headers compare equal across pages. */
export function normalizeHeader(t) {
  const despaced = /^(?:\S ){3,}\S/.test(t) ? t.replace(/(?<=\S) (?=\S)/g, '') : t;
  return despaced.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * First pass over the PDF: one cheap read per page that yields the signals the classifier and
 * the extractors need (text volume, graphics, font-size hierarchy, running headers).
 */
export async function analyzePdf(filePath, onProgress) {
  const pdf = await openPdf(filePath);
  const pages = [];
  const dominant = [];
  const edgeLines = new Map();
  const headingSizeVotes = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const layout = await getPageLayout(page);
    const lines = layoutToLines(layout);
    const graphics = await countGraphics(page);
    const chars = lines.reduce((a, l) => a + l.text.length, 0);
    const words = lines.flatMap((l) => l.text.split(/\s+/));
    const numericRatio = words.length ? words.filter((w) => NUMERIC.test(w) && /\d/.test(w)).length / words.length : 0;
    if (chars > 800) {
      const h = new Map();
      lines.forEach((l) => h.set(Math.round(l.size * 2) / 2, (h.get(Math.round(l.size * 2) / 2) || 0) + l.text.length));
      dominant.push([...h.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    }
    [...lines].sort((a, b) => b.y - a.y).forEach((l, i, arr) => {
      if (i < 2 || i >= arr.length - 2) edgeLines.set(normalizeHeader(l.text), (edgeLines.get(normalizeHeader(l.text)) || 0) + 1);
    });
    pages.push({ pageNumber: n, charCount: chars, imageCount: graphics.images, pathCount: graphics.paths, numericRatio, lineCount: lines.length, lines: lines.map((l) => ({ t: l.text, s: l.size, b: l.bold })) });
    onProgress?.(n / pdf.numPages);
  }

  const bodySize = median(dominant) ?? 10;
  const runningHeaders = [...edgeLines.entries()].filter(([t, c]) => c >= Math.max(3, pdf.numPages * 0.25) && t.length < 80).map(([t]) => t);
  const votePages = new Map();
  for (const p of pages) {
    for (const l of p.lines) {
      if (l.s >= bodySize * 1.15 && l.s <= bodySize * 3 && l.t.length < 160 && !runningHeaders.includes(normalizeHeader(l.t))) {
        const k = Math.round(l.s * 2) / 2;
        headingSizeVotes.push(k);
        (votePages.get(k) || votePages.set(k, new Set()).get(k)).add(p.pageNumber);
      }
    }
  }
  const minPages = Math.max(3, pdf.numPages * 0.04);
  const headingSizes = [...votePages.entries()].filter(([, set]) => set.size >= minPages).map(([k]) => k).sort((a, b) => b - a).slice(0, 4);
  const headingLineCount = headingSizeVotes.filter((v) => headingSizes.includes(v)).length;
  const proseHeadingPages = pages.filter((p) => p.charCount > 1200 && votePagesHas(votePages, headingSizes, p.pageNumber)).length;
  const slim = pages.map(({ lines, ...rest }) => rest);
  return { pageCount: pdf.numPages, pages: slim, bodySize, headingSizes, headingLineCount, proseHeadingPages, runningHeaders };
}

function votePagesHas(votePages, sizes, pageNumber) {
  return sizes.some((s) => votePages.get(s)?.has(pageNumber));
}

export function isImagePage(p) {
  return p.charCount < env.MIN_PAGE_TEXT_CHARS && p.imageCount > 0;
}

export function isVisualPage(p) {
  const graphicHeavy = p.pathCount >= 15 || p.imageCount >= 3;
  return (graphicHeavy && p.charCount < 1500) || (p.numericRatio > 0.18 && p.charCount < 1800 && (p.pathCount > 3 || p.imageCount > 0));
}
