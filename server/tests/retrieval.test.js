import { describe, it, expect } from 'vitest';
import { analyzeQuery } from '../src/services/retrieval/queryAnalyzer.js';
import { heuristicRerank } from '../src/services/retrieval/rerank.js';
import { fuse, isolateDominantDocument } from '../src/services/retrieval/hybridRetriever.js';

describe('analyzeQuery', () => {
  it('extracts region, chapter and intent', () => {
    expect(analyzeQuery('What is the growth outlook for South Asia?').region).toBe('South Asia');
    expect(analyzeQuery('What does Chapter 3 say about sovereign debt?').chapterNumber).toBe(3);
    expect(analyzeQuery('How many libraries did staff visit?').wantsNumber).toBe(true);
    expect(analyzeQuery('What is the iMac carbon footprint?').wantsVisual).toBe(true);
    expect(analyzeQuery('According to the executive summary, what are the risks?').sectionHint).toBe('executive summary');
  });
});

describe('fuse', () => {
  it('ranks items present in both lists first', () => {
    const a = [{ chunkId: 'x' }, { chunkId: 'y' }];
    const b = [{ chunkId: 'y' }, { chunkId: 'z' }];
    expect(fuse([a, b])[0].chunkId).toBe('y');
  });
});

describe('heuristicRerank', () => {
  it('demotes chunks from another region', () => {
    const analysis = analyzeQuery('growth outlook for South Asia');
    const chunks = [
      { chunkId: 'a', content: 'Growth outlook is strong.', region: 'Sub-Saharan Africa', fused: 0.03, chunkType: 'child' },
      { chunkId: 'b', content: 'Growth outlook is moderate.', region: 'South Asia', fused: 0.02, chunkType: 'child' },
    ];
    expect(heuristicRerank(chunks, analysis)[0].chunkId).toBe('b');
  });
});

describe('isolateDominantDocument', () => {
  it('keeps one document when evidence clearly belongs to it', () => {
    const ranked = ['A', 'A', 'A', 'A', 'B', 'A'].map((d, i) => ({ chunkId: String(i), documentId: d }));
    expect(isolateDominantDocument(ranked, ['A', 'B']).every((c) => c.documentId === 'A')).toBe(true);
  });
  it('keeps both when evidence is split', () => {
    const ranked = ['A', 'B', 'A', 'B', 'A', 'B'].map((d, i) => ({ chunkId: String(i), documentId: d }));
    expect(isolateDominantDocument(ranked, ['A', 'B'])).toHaveLength(6);
  });
});
