import { z } from 'zod';
import mongoose from 'mongoose';
import { Conversation, Chunk } from '../models/index.js';
import { answerQuestion } from '../services/rag.service.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const body = z.object({
  question: z.string().trim().min(2).max(2000),
  documentIds: z.array(z.string().regex(/^[0-9a-f]{24}$/)).max(50).default([]),
  conversationId: z.string().regex(/^[0-9a-f]{24}$/).optional(),
});

export async function chat(req, res) {
  res.json(await answerQuestion(body.parse(req.body)));
}

/** Server-sent events: `sources`, repeated `token`, then `done` (or `error`). */
export async function chatStream(req, res) {
  const input = body.parse(req.body);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const result = await answerQuestion({ ...input, onSources: (s) => send('sources', s), onText: (t) => send('token', t) });
    send('done', result);
  } catch (err) {
    logger.error({ err }, 'stream failed');
    send('error', { message: err.status && err.status < 500 ? err.message : err.message || 'Generation failed' });
  }
  res.end();
}

export async function history(req, res) {
  if (req.query.id) {
    const c = await Conversation.findById(String(req.query.id)).lean();
    if (!c) throw notFound('Conversation not found');
    return res.json(c);
  }
  res.json(await Conversation.find({}, 'title documentIds updatedAt').sort('-updatedAt').limit(50).lean());
}

export async function clearConversation(req, res) {
  await Conversation.deleteOne({ _id: req.params.id });
  res.status(204).end();
}

export async function source(req, res) {
  const id = req.params.id;
  const chunk = await Chunk.findOne(mongoose.isValidObjectId(id) ? { $or: [{ _id: id }, { chunkId: id }] } : { chunkId: id }).lean();
  if (!chunk) throw notFound('Source not found');
  res.json(chunk);
}
