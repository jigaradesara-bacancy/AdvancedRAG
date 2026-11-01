import { Document } from '../../models/index.js';
import { logger } from '../../utils/logger.js';
import { processDocument } from './pipeline.js';

const queue = [];
let running = false;

/** Single-worker in-process queue; documents left mid-run by a crash are re-queued on startup. */
export function enqueue(documentId, opts = {}) {
  queue.push({ documentId: String(documentId), opts });
  Document.updateOne({ _id: documentId }, { status: 'queued', stage: 'queued', error: null }).then(drain);
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      await processDocument(job.documentId, job.opts);
    } catch (err) {
      logger.error({ err }, 'job crashed');
    }
  }
  running = false;
}

export async function recoverInterrupted() {
  const stuck = await Document.find({ status: { $in: ['queued', 'processing'] } }, '_id').lean();
  stuck.forEach((d) => enqueue(d._id));
  if (stuck.length) logger.info({ count: stuck.length }, 're-queued interrupted documents');
}
