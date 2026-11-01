import { countTokens, sha256 } from '../../utils/text.js';

export function makeChunk(doc, seq, fields) {
  const content = fields.content.trim();
  return {
    documentId: doc._id,
    documentName: doc.name,
    documentType: doc.classification?.type,
    chunkId: `${doc._id}:${fields.chunkType}:${seq}`,
    contentHash: sha256(`${fields.chunkType}|${content}`),
    tokenCount: countTokens(content),
    processingVersion: doc.processingVersion,
    ...fields,
    content,
  };
}

/** Text used for embedding: content prefixed with its location so short chunks stay interpretable. */
export function embeddingText(chunk) {
  const where = [chunk.chapter, chunk.section, chunk.subsection].filter(Boolean).join(' > ');
  const label = chunk.sourceReference || `Page ${chunk.pageNumber}`;
  return `${chunk.documentName} | ${label}${where ? ` | ${where}` : ''}\n${chunk.content}`;
}
