import { paragraphChunker } from './paragraphChunker.js';
import { hierarchicalChunker } from './hierarchicalChunker.js';
import { elementChunker } from './elementChunker.js';

/** Tables of contents and indexes are dot-leader lists that match every query and answer none. */
export const isContentsListing = (text) => (text.match(/\.{6,}|(?:\. ){6,}/g) || []).length >= 3;

const textStrategies = { paragraph: paragraphChunker, element: paragraphChunker, hierarchical: hierarchicalChunker };

/**
 * Common chunking interface. A text strategy handles prose; element chunks are added whenever the
 * document produced visual elements, so mixed PDFs use both.
 */
export function chunkDocument(doc, { strategy, pages, elements }) {
  const text = (textStrategies[strategy] || paragraphChunker)(doc, pages);
  text.chunks = text.chunks.filter((c) => !isContentsListing(c.content));
  const elementChunks = elementChunker(doc, elements, text.pageContext, text.chunks.length);
  return [...text.chunks, ...elementChunks];
}

export { paragraphChunker, hierarchicalChunker, elementChunker };
