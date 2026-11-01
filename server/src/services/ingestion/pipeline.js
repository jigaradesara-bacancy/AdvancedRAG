import { env } from '../../config/env.js';
import { Document, Page, Chunk, VisualElement } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { analyzePdf } from './analyzer.js';
import { classify } from './classifier.js';
import { getExtractor } from '../extraction/index.js';
import { openPdf, getPageLayout, layoutToLines } from '../extraction/pdfLoader.js';
import { terminateOcr } from '../extraction/OCRExtractor.js';
import { chunkDocument } from '../chunking/index.js';
import { embeddingText } from '../chunking/common.js';
import { embedDocuments } from '../embedding.service.js';
import { ensureVectorIndex } from '../vectorStore.service.js';

const STAGES = ['analyze', 'extract', 'chunk', 'embed'];

async function addUsage(doc, u = {}) {
  await Document.updateOne({ _id: doc._id }, { $inc: {
    'usage.inputTokens': u.inputTokens || 0, 'usage.outputTokens': u.outputTokens || 0,
    'usage.embeddingTokens': u.embeddingTokens || 0, 'usage.visionCalls': u.visionCalls || 0, 'usage.costUsd': u.costUsd || 0,
  } });
}

const setStage = (doc, stage, progress) => Document.updateOne({ _id: doc._id }, { stage, progress });
const markDone = (doc, stage) => Document.updateOne({ _id: doc._id }, { $addToSet: { completedStages: stage } });

async function analyzeStage(doc) {
  if (!doc.analysis) {
    const analysis = await analyzePdf(doc.filePath, (f) => setStage(doc, 'analyze', Math.round(f * 15)));
    await Document.updateOne({ _id: doc._id }, { analysis, pageCount: analysis.pageCount });
    doc.analysis = analysis;
  }
  const c = classify(doc.analysis, doc.strategyOverride);
  const classification = { type: c.type, confidence: c.confidence, signals: { ...c.signals, detectedType: c.detectedType }, pagePlan: c.pagePlan };
  await Document.updateOne({ _id: doc._id }, { classification, chunkStrategy: c.chunkStrategy });
  doc.classification = classification;
  doc.chunkStrategy = c.chunkStrategy;
}

function elementRef(pageNumber, type, index, title) {
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `Page ${pageNumber}, ${label} ${index}${title ? ` (${title})` : ''}`;
}

async function extractStage(doc) {
  const pdf = await openPdf(doc.filePath);
  const done = new Set((await Page.find({ documentId: doc._id }, 'pageNumber').lean()).map((p) => p.pageNumber));
  const plan = doc.classification.pagePlan;
  const signals = doc.classification.signals;

  for (const { page: pageNumber, extractors } of plan) {
    if (done.has(pageNumber)) continue;
    const page = await pdf.getPage(pageNumber);
    const layout = await getPageLayout(page);
    const rawText = layoutToLines(layout).map((l) => l.text).join(' ');
    const ctx = { pdf, page, layout, pageNumber, signals, documentId: doc._id, pageText: rawText };
    const record = { documentId: doc._id, pageNumber, extractors, charCount: rawText.length };
    const elements = [];
    let usage = {};
    let visualFound = false;

    for (const name of extractors) {
      const result = await getExtractor(name).extractPage(ctx);
      if (name === 'table') {
        result.tables.forEach((t, i) => elements.push({
          elementType: 'table', title: t.caption, data: { rows: t.rows, markdown: t.markdown, headerRows: t.headerRows },
          sourceReference: elementRef(pageNumber, 'table', i + 1, t.caption?.slice(0, 60)), extractionMethod: result.method,
        }));
      } else if (name === 'visual') {
        visualFound = result.elements.length > 0;
        record.imagePath = result.imagePath;
        record.imageHash = result.imageHash;
        const counters = {};
        for (const e of result.elements) {
          const type = ['chart', 'table', 'icon', 'image', 'diagram'].includes(e.elementType) ? e.elementType : 'image';
          counters[type] = (counters[type] || 0) + 1;
          elements.push({
            elementType: type, title: e.title, description: e.description, footnotes: e.footnotes || [], validation: e.validation,
            data: { categories: e.categories, series: e.series, unit: e.unit, columns: e.columns, rows: e.rows, claims: e.claims },
            sourceReference: elementRef(pageNumber, type, counters[type], e.title), extractionMethod: result.method,
          });
        }
        usage = result.usage;
      } else {
        Object.assign(record, {
          text: result.text, paragraphs: result.paragraphs, blocks: result.blocks, method: result.method,
          chapterNumber: result.chapterNumber || undefined,
        });
      }
    }
    if (!record.text) record.text = rawText;
    const kept = visualFound ? elements.filter((e) => !(e.elementType === 'table' && e.extractionMethod === 'table-heuristic')) : elements;
    await Page.create(record);
    if (kept.length) await VisualElement.insertMany(kept.map((e) => ({ ...e, documentId: doc._id, pageNumber, processingVersion: doc.processingVersion })));
    await addUsage(doc, usage);
    await setStage(doc, 'extract', 15 + Math.round((pageNumber / plan.length) * 55));
  }
  await terminateOcr();
}

async function chunkStage(doc) {
  const [pages, elements] = await Promise.all([
    Page.find({ documentId: doc._id }).sort('pageNumber').lean(),
    VisualElement.find({ documentId: doc._id }).sort('pageNumber').lean(),
  ]);
  const chunks = chunkDocument(doc, { strategy: doc.chunkStrategy, pages, elements });
  await Chunk.deleteMany({ documentId: doc._id });
  const seen = new Set();
  const unique = chunks.filter((c) => {
    const k = `${c.pageNumber}|${c.contentHash}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length) await Chunk.insertMany(unique, { ordered: false });
  await Document.updateOne({ _id: doc._id }, { chunkCount: unique.length });
  await setStage(doc, 'chunk', 78);
}

async function embedStage(doc) {
  const pending = await Chunk.find({ documentId: doc._id, chunkType: { $ne: 'parent' }, embedding: { $exists: false } }, '+embedding').lean();
  const size = env.EMBEDDING_BATCH_SIZE * 4;
  for (let i = 0; i < pending.length; i += size) {
    const slice = pending.slice(i, i + size);
    const usage = {};
    const vectors = await embedDocuments(slice.map(embeddingText), { onUsage: (u) => { usage.embeddingTokens = (usage.embeddingTokens || 0) + u.embeddingTokens; usage.costUsd = (usage.costUsd || 0) + u.costUsd; } });
    await Chunk.bulkWrite(slice.map((c, k) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { embedding: vectors[k] } } } })));
    await addUsage(doc, usage);
    await setStage(doc, 'embed', 78 + Math.round(((i + slice.length) / pending.length) * 20));
  }
}

const runners = { analyze: analyzeStage, extract: extractStage, chunk: chunkStage, embed: embedStage };

/**
 * Runs the pipeline stage by stage. Completed stages are skipped and extraction skips pages that
 * are already stored, so a failed run resumes where it stopped. `force` wipes derived data first
 * (vision and embedding results stay cached, so re-indexing is cheap).
 */
export async function processDocument(documentId, { force = false } = {}) {
  let doc = await Document.findById(documentId);
  if (!doc) return;
  if (!force && doc.status === 'ready' && doc.processingVersion === env.PROCESSING_VERSION) return;
  const stale = doc.processingVersion != null && doc.processingVersion !== env.PROCESSING_VERSION;
  if (force || stale) {
    await Promise.all([Page.deleteMany({ documentId }), Chunk.deleteMany({ documentId }), VisualElement.deleteMany({ documentId })]);
    await Document.updateOne({ _id: documentId }, { completedStages: [], chunkCount: 0, ...(force ? { analysis: null } : {}) });
    doc = await Document.findById(documentId);
  }
  await Document.updateOne({ _id: documentId }, { status: 'processing', error: null, processingVersion: env.PROCESSING_VERSION });
  doc = await Document.findById(documentId);

  try {
    for (const stage of STAGES) {
      if (doc.completedStages.includes(stage) && stage !== 'analyze') continue;
      logger.info({ documentId, stage }, 'stage start');
      await setStage(doc, stage, doc.progress);
      await runners[stage](doc);
      await markDone(doc, stage);
      doc = await Document.findById(documentId);
    }
    await ensureVectorIndex();
    await Document.updateOne({ _id: documentId }, { status: 'ready', stage: 'done', progress: 100 });
    logger.info({ documentId, chunks: doc.chunkCount }, 'document ready');
  } catch (err) {
    logger.error({ err, documentId }, 'processing failed');
    await Document.updateOne({ _id: documentId }, { status: 'failed', error: err.message });
  }
}
