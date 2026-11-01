import { describe, it, expect } from 'vitest';
import { paragraphChunker } from '../src/services/chunking/paragraphChunker.js';
import { hierarchicalChunker } from '../src/services/chunking/hierarchicalChunker.js';
import { elementChunker } from '../src/services/chunking/elementChunker.js';

const doc = { _id: 'd1', name: 'Test Doc', classification: { type: 'plain' }, processingVersion: 1 };
const sentence = (n) => `Sentence number ${n} reports a figure of ${n * 7} units for the period. `;

describe('paragraphChunker', () => {
  it('keeps pages separate and never ends a chunk mid-sentence', () => {
    const long = Array.from({ length: 80 }, (_, i) => sentence(i)).join('');
    const { chunks } = paragraphChunker(doc, [
      { pageNumber: 1, paragraphs: [{ text: long }] },
      { pageNumber: 2, paragraphs: [{ text: 'A short paragraph on page two. It has two sentences.' }] },
    ]);
    expect(new Set(chunks.map((c) => c.pageNumber))).toEqual(new Set([1, 2]));
    chunks.filter((c) => c.pageNumber === 1).forEach((c) => expect(c.content).toMatch(/units for the period\.$/));
    expect(chunks.every((c) => c.sourceReference.startsWith('Page'))).toBe(true);
  });
});

describe('hierarchicalChunker', () => {
  const pages = [
    { pageNumber: 10, chapterNumber: 2, blocks: [
      { type: 'heading', level: 1, text: 'Regional Outlooks' },
      { type: 'heading', level: 2, text: 'South Asia' },
      { type: 'paragraph', text: 'Growth in South Asia is projected at 6.1 percent.' },
      { type: 'heading', level: 2, text: 'Sub-Saharan Africa' },
      { type: 'paragraph', text: 'Growth in Sub-Saharan Africa is projected at 3.5 percent.' },
      { type: 'heading', level: 2, isBox: true, text: 'BOX 2.1 A boxed note' },
    ] },
  ];

  it('builds parents and children and keeps regions apart', () => {
    const { chunks } = hierarchicalChunker(doc, pages);
    const children = chunks.filter((c) => c.chunkType === 'child');
    const south = children.find((c) => c.content.includes('South Asia'));
    const africa = children.find((c) => c.content.includes('Sub-Saharan'));
    expect(south.region).toBe('South Asia');
    expect(africa.region).toBe('Sub-Saharan Africa');
    expect(south.parentChunkId).not.toBe(africa.parentChunkId);
    expect(chunks.find((c) => c.chunkId === south.parentChunkId).chunkType).toBe('parent');
    expect(south.chapterNumber).toBe(2);
  });
});

describe('hierarchicalChunker chapter labels', () => {
  it('uses one label whether the chapter comes from a running header or a heading', () => {
    const { chunks } = hierarchicalChunker(doc, [
      { pageNumber: 1, chapterNumber: 1, blocks: [{ type: 'heading', level: 1, text: 'CHAPTER 1' }, { type: 'paragraph', text: 'Opening text of the chapter.' }] },
      { pageNumber: 2, chapterNumber: 1, blocks: [{ type: 'paragraph', text: 'More text on the next page.' }] },
    ]);
    expect(new Set(chunks.map((c) => c.chapter))).toEqual(new Set(['Chapter 1']));
  });
});

describe('elementChunker', () => {
  it('attaches footnotes to the claim they qualify and keeps units', () => {
    const elements = [
      { _id: 'e1', pageNumber: 3, elementType: 'icon', sourceReference: 'Page 3, Icon 1', footnotes: [{ marker: '2', text: 'Excludes the cable.' }, { marker: '9', text: 'Unrelated note.' }], data: { claims: [{ text: '100% recycled aluminum', component: 'stand', footnoteMarkers: ['2'] }] } },
      { _id: 'e2', pageNumber: 4, elementType: 'chart', title: 'Carbon', sourceReference: 'Page 4, Chart 1', footnotes: [], data: { categories: ['Use', 'Manufacturing'], series: [{ name: 'kg', values: [10, null] }], unit: 'kg CO2e' } },
    ];
    const chunks = elementChunker(doc, elements);
    const claim = chunks.find((c) => c.chunkType === 'icon');
    expect(claim.content).toContain('stand');
    expect(claim.content).toContain('[2] Excludes the cable.');
    expect(claim.content).not.toContain('Unrelated');
    expect(chunks.find((c) => c.chunkType === 'footnote').content).toContain('Unrelated note.');
    const chart = chunks.find((c) => c.chunkType === 'chart');
    expect(chart.content).toContain('Unit: kg CO2e');
    expect(chart.content).toContain('Manufacturing: not stated');
  });
});
