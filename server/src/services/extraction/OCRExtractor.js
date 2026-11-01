import { renderPagePng } from './pdfLoader.js';
import { env } from '../../config/env.js';

let workerPromise;
async function getWorker() {
  workerPromise ??= import('tesseract.js').then((t) => t.createWorker(env.OCR_LANG));
  return workerPromise;
}

export async function terminateOcr() {
  if (!workerPromise) return;
  const w = await workerPromise;
  await w.terminate();
  workerPromise = null;
}

/** OCR for pages that have an image but no text layer. */
export class OCRExtractor {
  name = 'ocr';
  async extractPage({ pdf, pageNumber }) {
    const { buffer } = await renderPagePng(pdf, pageNumber, 2.5);
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    const paragraphs = data.text.split(/\n{2,}/).map((t) => t.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((text) => ({ type: 'paragraph', text }));
    return { paragraphs, text: paragraphs.map((p) => p.text).join('\n\n'), method: 'ocr', confidence: data.confidence };
  }
}
