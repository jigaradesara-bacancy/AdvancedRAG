import { isImagePage, isVisualPage } from './analyzer.js';
import { env } from '../../config/env.js';

const DEFAULT_PLAN = {
  plain: ['text'],
  structured: ['structured', 'table'],
  visual: ['text', 'table', 'visual'],
  scanned: ['ocr'],
};

/**
 * Maps analyzer signals to a document type and a per-page extractor plan. Only measured
 * properties of the PDF are used; the file name is never consulted.
 */
export function classify(analysis, override = null) {
  const { pages, pageCount, headingSizes, headingLineCount, proseHeadingPages } = analysis;
  const scanned = pages.filter(isImagePage);
  const visual = pages.filter((p) => isVisualPage(p) && !isImagePage(p));
  const scannedRatio = scanned.length / pageCount;
  const visualRatio = visual.length / pageCount;
  const headingDensity = headingLineCount / pageCount;
  const hierarchical = pageCount >= 40 && headingSizes.length >= 1 && proseHeadingPages / pageCount >= 0.18;

  let type;
  let confidence = 0.7;
  if (scannedRatio >= 0.6) { type = 'scanned'; confidence = scannedRatio; }
  else if (scannedRatio >= 0.1 || (visualRatio >= 0.35 && visualRatio < 0.5 && pageCount > 15)) { type = 'mixed'; confidence = 0.6; }
  else if (hierarchical) { type = 'structured'; confidence = Math.min(0.95, 0.6 + headingSizes.length * 0.1); }
  else if (visualRatio >= 0.45) { type = 'visual'; confidence = visualRatio; }
  else { type = 'plain'; confidence = 0.8; }

  const effective = override || type;
  const visualPageSet = new Set(visual.map((p) => p.pageNumber));
  let visualBudget = env.VISION_MAX_PAGES;
  const pagePlan = pages.map((p) => {
    let extractors;
    if (effective === 'mixed') {
      const base = hierarchical ? ['structured'] : ['text'];
      extractors = isImagePage(p) ? ['ocr'] : visualPageSet.has(p.pageNumber) ? [...base, 'table', 'visual'] : [...base, 'table'];
    } else if (effective === 'scanned') {
      extractors = ['ocr'];
    } else {
      extractors = [...DEFAULT_PLAN[effective]];
      if (isImagePage(p) && !extractors.includes('ocr')) extractors = ['ocr'];
    }
    if (extractors.includes('visual')) {
      if (visualBudget-- <= 0) extractors = extractors.filter((e) => e !== 'visual');
    }
    return { page: p.pageNumber, extractors };
  });

  return {
    type: effective,
    detectedType: type,
    confidence: Number(confidence.toFixed(2)),
    signals: {
      pageCount, scannedRatio: +scannedRatio.toFixed(2), visualRatio: +visualRatio.toFixed(2), headingDensity: +headingDensity.toFixed(2), proseHeadingPageRatio: +(proseHeadingPages / pageCount).toFixed(2),
      bodySize: analysis.bodySize, headingSizes, runningHeaders: analysis.runningHeaders, hierarchical,
    },
    pagePlan,
    chunkStrategy: chunkStrategyFor(effective, hierarchical),
  };
}

export function chunkStrategyFor(type, hierarchical) {
  if (type === 'visual') return 'element';
  if (type === 'structured' || (type === 'mixed' && hierarchical)) return 'hierarchical';
  return 'paragraph';
}
