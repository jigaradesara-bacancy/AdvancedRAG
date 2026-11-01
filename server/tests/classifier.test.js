import { describe, it, expect } from 'vitest';
import { classify } from '../src/services/ingestion/classifier.js';

const page = (n, over = {}) => ({ pageNumber: n, charCount: 2500, imageCount: 0, pathCount: 0, numericRatio: 0.05, ...over });
const analysis = (pages, extra = {}) => ({ pageCount: pages.length, pages, bodySize: 10, headingSizes: [], headingLineCount: 0, proseHeadingPages: 0, runningHeaders: [], ...extra });

describe('classify', () => {
  it('detects plain prose', () => {
    expect(classify(analysis(Array.from({ length: 30 }, (_, i) => page(i + 1)))).type).toBe('plain');
  });
  it('detects a long structured report from heading coverage', () => {
    const c = classify(analysis(Array.from({ length: 120 }, (_, i) => page(i + 1)), { headingSizes: [16, 13], headingLineCount: 200, proseHeadingPages: 60 }));
    expect(c.type).toBe('structured');
    expect(c.chunkStrategy).toBe('hierarchical');
  });
  it('detects a short visual document and plans vision per page', () => {
    const c = classify(analysis(Array.from({ length: 11 }, (_, i) => page(i + 1, { charCount: 700, pathCount: 40, imageCount: 2 }))));
    expect(c.type).toBe('visual');
    expect(c.chunkStrategy).toBe('element');
    expect(c.pagePlan[0].extractors).toContain('visual');
  });
  it('routes image-only pages to OCR', () => {
    const c = classify(analysis(Array.from({ length: 10 }, (_, i) => page(i + 1, { charCount: 3, imageCount: 1 }))));
    expect(c.type).toBe('scanned');
    expect(c.pagePlan[0].extractors).toEqual(['ocr']);
  });
  it('honours a manual override and keeps the detected type', () => {
    const c = classify(analysis(Array.from({ length: 30 }, (_, i) => page(i + 1))), 'visual');
    expect(c.type).toBe('visual');
    expect(c.detectedType).toBe('plain');
  });
  it('plans OCR only for image pages in a mixed document', () => {
    const pages = [...Array.from({ length: 9 }, (_, i) => page(i + 1)), page(10, { charCount: 0, imageCount: 1 })];
    const c = classify(analysis(pages));
    expect(c.type).toBe('mixed');
    expect(c.pagePlan[9].extractors).toEqual(['ocr']);
    expect(c.pagePlan[0].extractors).not.toContain('ocr');
  });
});
