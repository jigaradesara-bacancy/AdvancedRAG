import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, Page, Chunk, VisualElement } from '../models/index.js';
import { paths } from '../config/env.js';
import { sha256 } from '../utils/text.js';
import { conflict, badRequest, notFound } from '../utils/errors.js';
import { hasPdfSignature } from '../middleware/upload.js';
import { enqueue } from './ingestion/jobRunner.js';
import { logger } from '../utils/logger.js';

/** Registers a PDF (by hash, so the same file is never indexed twice) and queues processing. */
export async function registerPdf({ filePath, originalName, source, move = false }) {
  if (!(await hasPdfSignature(filePath))) {
    if (move) await fs.rm(filePath, { force: true });
    throw badRequest('File is not a valid PDF');
  }
  const data = await fs.readFile(filePath);
  const hash = sha256(data);
  const existing = await Document.findOne({ sha256: hash });
  if (existing) {
    if (move) await fs.rm(filePath, { force: true });
    throw conflict(`This file is already uploaded as "${existing.name}"`);
  }
  let finalPath = filePath;
  if (move) {
    finalPath = path.join(paths.uploadsDir, `${hash.slice(0, 16)}.pdf`);
    await fs.rename(filePath, finalPath);
  }
  const doc = await Document.create({
    name: originalName.replace(/\.pdf$/i, ''), originalFileName: originalName, filePath: finalPath,
    sha256: hash, sizeBytes: data.length, source,
  });
  enqueue(doc._id);
  return doc;
}

export async function scanDocumentsDirectory() {
  await fs.mkdir(paths.documentsDir, { recursive: true });
  const files = (await fs.readdir(paths.documentsDir)).filter((f) => /\.pdf$/i.test(f));
  const added = [];
  const skipped = [];
  for (const f of files) {
    try {
      added.push((await registerPdf({ filePath: path.join(paths.documentsDir, f), originalName: f, source: 'directory' })).name);
    } catch (err) {
      if (err.status === 409) skipped.push(f);
      else logger.warn({ file: f, msg: err.message }, 'scan skipped file');
    }
  }
  return { added, skipped };
}

export async function deleteDocument(id) {
  const doc = await Document.findById(id);
  if (!doc) throw notFound('Document not found');
  await Promise.all([Page.deleteMany({ documentId: id }), Chunk.deleteMany({ documentId: id }), VisualElement.deleteMany({ documentId: id })]);
  if (doc.source === 'upload') await fs.rm(doc.filePath, { force: true });
  await fs.rm(path.join(paths.pageImagesDir, String(id)), { recursive: true, force: true });
  await doc.deleteOne();
}
