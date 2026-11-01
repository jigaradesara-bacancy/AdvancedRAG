import fs from 'node:fs';
import { z } from 'zod';
import { Document, Page, Chunk, VisualElement } from '../models/index.js';
import { badRequest, notFound } from '../utils/errors.js';
import { registerPdf, deleteDocument, scanDocumentsDirectory } from '../services/document.service.js';
import { enqueue } from '../services/ingestion/jobRunner.js';
import { currentBackend } from '../services/vectorStore.service.js';

const processBody = z.object({
  force: z.boolean().default(true),
  strategyOverride: z.enum(['plain', 'structured', 'visual', 'scanned', 'mixed']).nullable().optional(),
});
const pageQuery = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) });

const LIST_FIELDS = '-analysis -classification.pagePlan';

async function loadDoc(id) {
  const doc = await Document.findById(id);
  if (!doc) throw notFound('Document not found');
  return doc;
}

export async function upload(req, res) {
  if (!req.file) throw badRequest('Attach a PDF in the "file" field');
  const doc = await registerPdf({ filePath: req.file.path, originalName: req.file.originalname, source: 'upload', move: true });
  res.status(202).json({ id: doc._id, status: doc.status, name: doc.name });
}

export async function scan(req, res) {
  res.json(await scanDocumentsDirectory());
}

export async function list(req, res) {
  res.json(await Document.find({}, LIST_FIELDS).sort('-createdAt').lean());
}

export async function get(req, res) {
  const doc = await Document.findById(req.params.id, '-analysis').lean();
  if (!doc) throw notFound('Document not found');
  const [pages, visualElements] = await Promise.all([Page.countDocuments({ documentId: doc._id }), VisualElement.countDocuments({ documentId: doc._id })]);
  res.json({ ...doc, extractedPages: pages, visualElementCount: visualElements });
}

export async function remove(req, res) {
  await deleteDocument(req.params.id);
  res.status(204).end();
}

export async function reprocess(req, res) {
  const body = processBody.parse(req.body ?? {});
  const doc = await loadDoc(req.params.id);
  if (['queued', 'processing'].includes(doc.status)) throw badRequest('Document is already being processed');
  if (body.strategyOverride !== undefined) doc.strategyOverride = body.strategyOverride;
  await doc.save();
  enqueue(doc._id, { force: body.force || body.strategyOverride !== undefined });
  res.status(202).json({ id: doc._id, status: 'queued' });
}

export async function status(req, res) {
  const doc = await Document.findById(req.params.id, 'status stage progress error usage chunkCount completedStages processingVersion').lean();
  if (!doc) throw notFound('Document not found');
  res.json(doc);
}

export async function extraction(req, res) {
  const { page, limit } = pageQuery.parse(req.query);
  const doc = await loadDoc(req.params.id);
  const [pages, total] = await Promise.all([
    Page.find({ documentId: doc._id }, '-blocks -paragraphs').sort('pageNumber').skip((page - 1) * limit).limit(limit).lean(),
    Page.countDocuments({ documentId: doc._id }),
  ]);
  res.json({ classification: doc.classification, chunkStrategy: doc.chunkStrategy, total, page, limit, pages });
}

export async function chunks(req, res) {
  const { page, limit } = pageQuery.parse(req.query);
  const doc = await loadDoc(req.params.id);
  const filter = { documentId: doc._id };
  if (req.query.type) filter.chunkType = String(req.query.type);
  if (req.query.pageNumber) filter.pageNumber = Number(req.query.pageNumber);
  if (req.query.q) filter.$text = { $search: String(req.query.q) };
  const [items, total] = await Promise.all([
    Chunk.find(filter).sort('pageNumber chunkId').skip((page - 1) * limit).limit(limit).lean(),
    Chunk.countDocuments(filter),
  ]);
  res.json({ total, page, limit, backend: currentBackend(), items });
}

/** Chapter > section > subsection tree built from chunk metadata. */
export async function structure(req, res) {
  const doc = await loadDoc(req.params.id);
  const rows = await Chunk.find({ documentId: doc._id, chunkType: { $in: ['parent', 'child'] } }, 'chapter section subsection pageNumber region chunkType').sort('pageNumber').lean();
  const tree = new Map();
  for (const r of rows) {
    const ch = tree.get(r.chapter || '(no chapter)') || tree.set(r.chapter || '(no chapter)', { title: r.chapter || '(no chapter)', firstPage: r.pageNumber, sections: new Map() }).get(r.chapter || '(no chapter)');
    if (!r.section) continue;
    const sec = ch.sections.get(r.section) || ch.sections.set(r.section, { title: r.section, firstPage: r.pageNumber, region: r.region, subsections: new Set() }).get(r.section);
    if (r.subsection) sec.subsections.add(r.subsection);
  }
  res.json({
    type: doc.classification?.type, strategy: doc.chunkStrategy,
    chapters: [...tree.values()].map((c) => ({ ...c, sections: [...c.sections.values()].map((s) => ({ ...s, subsections: [...s.subsections] })) })),
  });
}

export async function visualElements(req, res) {
  const doc = await loadDoc(req.params.id);
  const filter = { documentId: doc._id };
  if (req.query.type) filter.elementType = String(req.query.type);
  res.json(await VisualElement.find(filter).sort('pageNumber').lean());
}

export async function pageImage(req, res) {
  const page = await Page.findOne({ documentId: req.params.id, pageNumber: Number(req.params.n) }).lean();
  if (!page?.imagePath || !fs.existsSync(page.imagePath)) throw notFound('No rendered image for this page');
  res.type('png');
  fs.createReadStream(page.imagePath).pipe(res);
}

export async function file(req, res) {
  const doc = await loadDoc(req.params.id);
  res.type('pdf');
  fs.createReadStream(doc.filePath).pipe(res);
}

export async function stats(req, res) {
  const [byStatus, chunkTotal, usage] = await Promise.all([
    Document.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Chunk.countDocuments({ chunkType: { $ne: 'parent' } }),
    Document.aggregate([{ $group: { _id: null, inputTokens: { $sum: '$usage.inputTokens' }, outputTokens: { $sum: '$usage.outputTokens' }, embeddingTokens: { $sum: '$usage.embeddingTokens' }, visionCalls: { $sum: '$usage.visionCalls' }, costUsd: { $sum: '$usage.costUsd' } } }]),
  ]);
  const count = (s) => byStatus.find((b) => b._id === s)?.count || 0;
  res.json({
    total: byStatus.reduce((a, b) => a + b.count, 0), ready: count('ready'), failed: count('failed'),
    inProgress: count('queued') + count('processing'), chunks: chunkTotal, vectorBackend: currentBackend(), usage: usage[0] || {},
  });
}
