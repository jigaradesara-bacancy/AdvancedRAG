import { keywords } from '../../utils/text.js';
import { detectRegion } from '../../utils/regions.js';

const SYNONYMS = [
  [/\bfy\s?(\d{2,4})\b/i, (m) => `fiscal year ${m[1]}`],
  [/\boutlook\b/i, () => 'forecast projected growth'],
  [/\bcarbon footprint\b/i, () => 'greenhouse gas emissions CO2e lifecycle'],
  [/\brecycled\b/i, () => 'recycled content material'],
  [/\bsovereign debt\b/i, () => 'government debt public debt'],
  [/\brisks?\b/i, () => 'downside risks uncertainty'],
  [/\benergy star\b/i, () => 'ENERGY STAR requirement power consumption'],
];

const NUMERIC_CUE = /\b(how many|how much|what percent|percentage|total|number of|amount|cost|rate|\d)/i;
const VISUAL_CUE = /\b(chart|table|figure|graph|diagram|icon|footprint|emissions?|recycled|material|energy|power consumption|kwh|kg|co2e?)\b/i;
const SUMMARY_CUE = /\b(executive summary|overview|summary|foreword|message|introduction)\b/i;

/**
 * Rule-based query understanding. It runs on every question, so it makes no model calls; the
 * signals only steer filters and boosts, and filters are relaxed when they remove too much.
 */
export function analyzeQuery(question) {
  const chapterMatch = question.match(/\bchapter\s+(\d{1,2})\b/i);
  const summary = question.match(SUMMARY_CUE)?.[1]?.toLowerCase() || null;
  const expansions = SYNONYMS.flatMap(([re, fn]) => {
    const m = question.match(re);
    return m ? [fn(m)] : [];
  });
  return {
    question,
    keywords: keywords(question),
    expandedQuery: [question, ...expansions].join(' '),
    region: detectRegion(question),
    chapterNumber: chapterMatch ? Number(chapterMatch[1]) : null,
    sectionHint: summary,
    wantsNumber: NUMERIC_CUE.test(question),
    wantsVisual: VISUAL_CUE.test(question),
  };
}
