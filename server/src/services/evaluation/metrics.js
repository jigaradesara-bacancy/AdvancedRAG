import { extractNumbers } from '../../utils/text.js';

const norm = (s) => String(s).toLowerCase().replace(/[,\s]+/g, ' ').trim();
const numNorm = (s) => (/^[\d.,]+$/.test(String(s).trim()) ? String(Number(String(s).replace(/,/g, ''))) : null);

export function precisionAtK(retrieved, expectedPages, k) {
  if (!expectedPages?.length) return null;
  const top = retrieved.slice(0, k);
  if (!top.length) return 0;
  const hits = top.filter((c) => expectedPages.includes(c.pageNumber) || (c.pageEnd && expectedPages.some((p) => p >= c.pageNumber && p <= c.pageEnd)));
  return hits.length / top.length;
}

export function recallAtK(retrieved, expectedPages, k) {
  if (!expectedPages?.length) return null;
  const covered = expectedPages.filter((p) => retrieved.slice(0, k).some((c) => c.pageNumber === p || (c.pageEnd && p >= c.pageNumber && p <= c.pageEnd)));
  return covered.length / expectedPages.length;
}

/** Fraction of expected facts present in the answer; numeric facts compare by value, not formatting. */
export function answerCorrectness(answer, expectedFacts) {
  if (!expectedFacts?.length) return null;
  const text = norm(answer);
  const answerNumbers = new Set(extractNumbers(answer).map((n) => String(Number(n))));
  const found = expectedFacts.filter((f) => {
    const n = numNorm(f);
    return n !== null ? answerNumbers.has(n) : text.includes(norm(f));
  });
  return found.length / expectedFacts.length;
}

/** Cited sources must be valid ids and include at least one expected page when pages are known. */
export function citationCorrectness(validation, citations, expectedPages) {
  if (validation.refused) return null;
  if (validation.invalidCitations?.length || !citations.length) return 0;
  if (!expectedPages?.length) return null;
  return citations.some((c) => expectedPages.includes(c.pageNumber)) ? 1 : 0;
}

export function faithfulness(validation) {
  return validation.ok || validation.refused ? 1 : 0;
}

/** Share of retrieved chunks that belong to the requested region or chapter; chunks without the tag are neutral. */
export function isolationScore(chunks, isolation) {
  if (!isolation) return null;
  const tagged = chunks.filter((c) => (isolation.region ? c.region : c.chapterNumber));
  if (!tagged.length) return 0;
  const ok = tagged.filter((c) => (isolation.region ? c.region === isolation.region : c.chapterNumber === isolation.chapterNumber));
  return ok.length / tagged.length;
}

export function visualExtractionAccuracy(expectedElements, elements) {
  if (!expectedElements?.length) return null;
  const hits = expectedElements.filter((exp) => {
    const onPage = elements.filter((e) => e.pageNumber === exp.page && (!exp.elementType || e.elementType === exp.elementType));
    const blob = norm(onPage.map((e) => JSON.stringify([e.title, e.data, e.footnotes])).join(' '));
    return (exp.contains || []).every((s) => blob.includes(norm(s)));
  });
  return hits.length / expectedElements.length;
}

export const mean = (xs) => {
  const v = xs.filter((x) => x !== null && x !== undefined);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
