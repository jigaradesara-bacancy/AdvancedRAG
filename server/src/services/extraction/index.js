import { TextExtractor } from './TextExtractor.js';
import { StructuredDocumentExtractor } from './StructuredDocumentExtractor.js';
import { TableExtractor } from './TableExtractor.js';
import { OCRExtractor } from './OCRExtractor.js';
import { VisualDocumentExtractor } from './VisualDocumentExtractor.js';

const registry = new Map();
[new TextExtractor(), new StructuredDocumentExtractor(), new TableExtractor(), new OCRExtractor(), new VisualDocumentExtractor()].forEach((e) => registry.set(e.name, e));

/** Extractors share one interface: extractPage(ctx) => partial page result. New ones register here. */
export const getExtractor = (name) => registry.get(name);
export const registerExtractor = (extractor) => registry.set(extractor.name, extractor);
