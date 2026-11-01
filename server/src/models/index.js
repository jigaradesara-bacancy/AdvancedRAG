import mongoose from 'mongoose';

const { Schema } = mongoose;
const usage = { inputTokens: { type: Number, default: 0 }, outputTokens: { type: Number, default: 0 }, embeddingTokens: { type: Number, default: 0 }, visionCalls: { type: Number, default: 0 }, costUsd: { type: Number, default: 0 } };

const documentSchema = new Schema({
  name: { type: String, required: true },
  originalFileName: String,
  filePath: { type: String, required: true },
  sha256: { type: String, required: true, unique: true },
  sizeBytes: Number,
  pageCount: Number,
  source: { type: String, enum: ['upload', 'directory'], default: 'upload' },
  classification: {
    type: { type: String, enum: ['plain', 'structured', 'visual', 'scanned', 'mixed'] },
    confidence: Number,
    signals: Schema.Types.Mixed,
    pagePlan: [{ page: Number, extractors: [String] }],
  },
  strategyOverride: { type: String, enum: ['plain', 'structured', 'visual', 'scanned', 'mixed', null], default: null },
  chunkStrategy: String,
  analysis: Schema.Types.Mixed,
  status: { type: String, enum: ['uploaded', 'queued', 'processing', 'ready', 'failed'], default: 'uploaded' },
  stage: String,
  completedStages: [String],
  progress: { type: Number, default: 0 },
  error: String,
  processingVersion: Number,
  chunkCount: { type: Number, default: 0 },
  usage,
}, { timestamps: true });

const pageSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, index: true, required: true },
  pageNumber: { type: Number, required: true },
  text: String,
  extractors: [String],
  charCount: Number,
  imageCount: Number,
  isScanned: Boolean,
  blocks: Schema.Types.Mixed,
  paragraphs: Schema.Types.Mixed,
  method: String,
  chapterNumber: Number,
  imagePath: String,
  imageHash: String,
});
pageSchema.index({ documentId: 1, pageNumber: 1 }, { unique: true });

const chunkSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, index: true, required: true },
  documentName: String,
  documentType: String,
  chunkId: { type: String, required: true, unique: true },
  chunkType: { type: String, enum: ['paragraph', 'parent', 'child', 'element', 'table', 'chart', 'icon', 'footnote', 'image', 'ocr'], required: true },
  content: { type: String, required: true },
  pageNumber: Number,
  pageEnd: Number,
  chapter: String,
  chapterNumber: Number,
  section: String,
  subsection: String,
  region: String,
  parentChunkId: String,
  elementType: String,
  elementId: String,
  sourceReference: String,
  extractionMethod: String,
  contentHash: String,
  tokenCount: Number,
  processingVersion: Number,
  embedding: { type: [Number], select: false },
  data: Schema.Types.Mixed,
});
chunkSchema.index({ content: 'text', section: 'text', chapter: 'text' }, { weights: { content: 5, section: 2, chapter: 1 } });
chunkSchema.index({ documentId: 1, parentChunkId: 1 });
chunkSchema.index({ documentId: 1, contentHash: 1 });

const visualElementSchema = new Schema({
  documentId: { type: Schema.Types.ObjectId, index: true, required: true },
  pageNumber: Number,
  elementType: { type: String, enum: ['chart', 'table', 'icon', 'image', 'footnote', 'diagram'] },
  title: String,
  data: Schema.Types.Mixed,
  footnotes: [{ marker: String, text: String }],
  sourceReference: String,
  description: String,
  validation: { checked: Number, matched: Number, unverified: [String] },
  extractionMethod: String,
  processingVersion: Number,
});

const conversationSchema = new Schema({
  title: String,
  documentIds: [Schema.Types.ObjectId],
  messages: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: String,
    citations: Schema.Types.Mixed,
    validation: Schema.Types.Mixed,
    usage: Schema.Types.Mixed,
    at: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

const evalRunSchema = new Schema({
  summary: Schema.Types.Mixed,
  results: [Schema.Types.Mixed],
}, { timestamps: true });

const cacheSchema = new Schema({
  key: { type: String, unique: true, required: true },
  value: Schema.Types.Mixed,
}, { timestamps: true });

export const Document = mongoose.model('Document', documentSchema);
export const Page = mongoose.model('Page', pageSchema);
export const Chunk = mongoose.model('Chunk', chunkSchema);
export const VisualElement = mongoose.model('VisualElement', visualElementSchema);
export const Conversation = mongoose.model('Conversation', conversationSchema);
export const EvalRun = mongoose.model('EvalRun', evalRunSchema);
export const Cache = mongoose.model('Cache', cacheSchema);
