import { describe, it, expect } from 'vitest';
import { validateAnswer } from '../src/services/answerGeneration.service.js';
import { validateAgainstText } from '../src/services/extraction/VisualDocumentExtractor.js';
import * as metrics from '../src/services/evaluation/metrics.js';

const sources = [{ sourceId: 'S1', content: 'GPO staff visited 1,234 libraries. Printing cost $4.5 million.' }];

describe('validateAnswer', () => {
  it('passes a grounded answer', () => {
    const v = validateAnswer('GPO staff visited 1,234 libraries [S1].', sources, 'How many libraries?');
    expect(v.ok).toBe(true);
    expect(v.citedSources).toEqual(['S1']);
  });
  it('flags an invented number', () => {
    const v = validateAnswer('GPO staff visited 999 libraries [S1].', sources);
    expect(v.ok).toBe(false);
    expect(v.unsupportedNumbers).toEqual(['999']);
  });
  it('flags a citation to a missing source', () => {
    expect(validateAnswer('GPO staff visited 1,234 libraries [S7].', sources).invalidCitations).toEqual(['S7']);
  });
  it('allows labelled calculations and refusals', () => {
    expect(validateAnswer('The difference is 3.3 (calculated: 4.5 - 1.2) [S1].', sources).unsupportedNumbers).toEqual([]);
    expect(validateAnswer('The answer cannot be determined from the available document content.', sources).ok).toBe(true);
  });
});

describe('validateAgainstText', () => {
  it('marks numbers absent from the page text as unverified', () => {
    const v = validateAgainstText({ series: [{ values: [10, 99] }], rows: [['Idle', '0.5 W']] }, 'Idle 0.5 W and 10 kg');
    expect(v.unverified).toEqual(['99']);
  });
});

describe('evaluation metrics', () => {
  const retrieved = [{ pageNumber: 5 }, { pageNumber: 9 }, { pageNumber: 5 }, { pageNumber: 2 }];
  it('computes precision and recall at k', () => {
    expect(metrics.precisionAtK(retrieved, [5], 4)).toBe(0.5);
    expect(metrics.recallAtK(retrieved, [5, 7], 4)).toBe(0.5);
    expect(metrics.precisionAtK(retrieved, [], 4)).toBeNull();
  });
  it('compares numeric facts by value', () => {
    expect(metrics.answerCorrectness('They visited 1234 libraries', ['1,234'])).toBe(1);
    expect(metrics.answerCorrectness('They visited 12 libraries', ['1,234'])).toBe(0);
  });
  it('scores isolation on tagged chunks only', () => {
    const chunks = [{ region: 'South Asia' }, { region: 'South Asia' }, { region: 'Sub-Saharan Africa' }, {}];
    expect(metrics.isolationScore(chunks, { region: 'South Asia' })).toBeCloseTo(2 / 3);
  });
});
