import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { paths } from '../../config/env.js';
import { sha256 } from '../../utils/text.js';

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const assetUrl = (dir) => pathToFileURL(path.join(pdfjsRoot, dir)).href + '/';

export async function openPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  return pdfjs.getDocument({
    data,
    standardFontDataUrl: assetUrl('standard_fonts'),
    cMapUrl: assetUrl('cmaps'),
    cMapPacked: true,
    useSystemFonts: true,
    fontExtraProperties: true,
    verbosity: 0,
  }).promise;
}

/**
 * Reads positioned text from a page and groups items into segments: runs of text on one baseline
 * with no wide gap. A wide gap starts a new segment, which is what lets table cells and columns
 * stay apart.
 */
async function operatorList(page) {
  page.ragOps ??= await page.getOperatorList();
  return page.ragOps;
}

function fontNameOf(page, id) {
  try {
    return page.commonObjs.get(id)?.name || '';
  } catch {
    return '';
  }
}

export async function getPageLayout(page) {
  const viewport = page.getViewport({ scale: 1 });
  await operatorList(page);
  const content = await page.getTextContent();
  const styles = content.styles || {};
  const items = content.items
    .filter((i) => i.str !== undefined && i.str.trim() !== '')
    .map((i) => ({
      font: fontNameOf(page, i.fontName).replace(/^[A-Z]{6}\+/, ''),
      text: i.str,
      x0: i.transform[4],
      x1: i.transform[4] + i.width,
      y: i.transform[5],
      size: Math.abs(i.transform[3]) || i.height,
      bold: /bold|black|heavy|semibold|demi/i.test(`${fontNameOf(page, i.fontName)} ${styles[i.fontName]?.fontFamily || ''}`),
    }));

  const rows = [];
  for (const it of items.sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) <= Math.max(2, it.size * 0.3));
    if (row) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  }

  const segments = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x0 - b.x0);
    let cur = null;
    for (const it of row.items) {
      const gap = cur ? it.x0 - cur.x1 : 0;
      if (cur && gap < Math.max(it.size * 1.8, 8)) {
        cur.text += (gap > it.size * 0.15 && !cur.text.endsWith(' ') ? ' ' : '') + it.text;
        cur.x1 = Math.max(cur.x1, it.x1);
        cur.size = Math.max(cur.size, it.size);
        cur.bold = cur.bold && it.bold;
      } else {
        if (cur) segments.push(cur);
        cur = { text: it.text, x0: it.x0, x1: it.x1, y: row.y, size: it.size, bold: it.bold, font: it.font };
      }
    }
    if (cur) segments.push(cur);
  }
  return { width: viewport.width, height: viewport.height, segments };
}

/** Finds an x position that no segment straddles, indicating a two-column page. */
function columnSplit(layout) {
  const body = layout.segments.filter((s) => s.text.length > 25);
  if (body.length < 12) return null;
  for (let f = 0.38; f <= 0.62; f += 0.02) {
    const mid = layout.width * f;
    const left = body.filter((s) => s.x1 <= mid + 2).length;
    const right = body.filter((s) => s.x0 >= mid - 2).length;
    const straddle = body.filter((s) => s.x0 < mid - 2 && s.x1 > mid + 2).length;
    if (left >= 6 && right >= 6 && straddle <= body.length * 0.1) return mid;
  }
  return null;
}

/** Reading-order lines: [{text, size, bold, y, x0, x1, segments}] with columns resolved. */
export function layoutToLines(layout, { columns = true } = {}) {
  const mid = columns ? columnSplit(layout) : null;
  const groups = mid
    ? [layout.segments.filter((s) => s.x0 < mid - 2), layout.segments.filter((s) => s.x0 >= mid - 2)]
    : [layout.segments];
  const lines = [];
  for (const segs of groups) {
    const byY = [];
    for (const s of segs.sort((a, b) => b.y - a.y || a.x0 - b.x0)) {
      const row = byY.find((r) => Math.abs(r.y - s.y) <= Math.max(2, s.size * 0.3));
      if (row) row.segments.push(s);
      else byY.push({ y: s.y, segments: [s] });
    }
    for (const r of byY) {
      r.segments.sort((a, b) => a.x0 - b.x0);
      lines.push({
        text: r.segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
        size: Math.max(...r.segments.map((s) => s.size)),
        bold: r.segments.every((s) => s.bold),
        font: r.segments[0].font,
        y: r.y,
        x0: r.segments[0].x0,
        x1: r.segments[r.segments.length - 1].x1,
        segments: r.segments,
      });
    }
  }
  return lines;
}

/** Joins lines into paragraphs using vertical gaps, indentation and sentence endings. */
export function isPageFurniture(line, layout, bodySize = 10) {
  const edge = line.y > layout.height * 0.93 || line.y < layout.height * 0.07;
  return edge && line.size <= bodySize * 0.95 && line.text.length < 120;
}

export function linesToParagraphs(lines) {
  const paras = [];
  let cur = null;
  let prev = null;
  for (const l of lines) {
    const gap = prev ? prev.y - l.y : 0;
    const newPara = !cur || gap > prev.size * 1.65 || gap < -prev.size * 3 || Math.abs(l.size - prev.size) > 1.5 || (l.x0 - prev.x0 > prev.size * 0.8 && /[.!?:]$/.test(prev.text));
    if (newPara) {
      cur = { text: l.text, size: l.size, bold: l.bold, y: l.y, x0: l.x0 };
      paras.push(cur);
    } else {
      cur.text = /-$/.test(cur.text) && /^[a-z]/.test(l.text) ? cur.text.slice(0, -1) + l.text : `${cur.text} ${l.text}`;
    }
    prev = l;
  }
  return paras;
}

/** Counts raster images and vector drawing operations; used to spot charts and image pages. */
export async function countGraphics(page) {
  const { OPS } = pdfjs;
  const list = await operatorList(page);
  let images = 0;
  let paths = 0;
  list.fnArray.forEach((fn) => {
    if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) images++;
    else if (fn === OPS.constructPath) paths++;
  });
  return { images, paths };
}

export async function renderPagePng(pdf, pageNumber, scale) {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  const buffer = canvas.toBuffer('image/png');
  return { buffer, hash: sha256(buffer) };
}

export async function savePageImage(documentId, pageNumber, buffer) {
  const dir = path.join(paths.pageImagesDir, String(documentId));
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `page-${pageNumber}.png`);
  await fs.writeFile(file, buffer);
  return file;
}
