import { Conversation, Document } from '../models/index.js';
import { retrieve } from './retrieval/hybridRetriever.js';
import { assembleContext } from './contextAssembler.js';
import { generateAnswer, streamAnswer, validateAnswer } from './answerGeneration.service.js';
import { badRequest } from '../utils/errors.js';

const NO_EVIDENCE = 'The answer cannot be determined from the available document content. No relevant passages were found in the selected documents.';

function publicSource(s) {
  return {
    sourceId: s.sourceId, chunkId: s.chunkId, documentId: s.documentId, documentName: s.documentName,
    pageNumber: s.pageNumber, pageEnd: s.pageEnd, chapter: s.chapter, section: s.section, subsection: s.subsection,
    chunkType: s.chunkType, elementType: s.elementType, sourceReference: s.sourceReference,
    evidence: s.content, isParentContext: !!s.isParentContext, score: s.rerankScore ?? null,
  };
}

async function resolveDocuments(documentIds) {
  const filter = documentIds?.length ? { _id: { $in: documentIds } } : {};
  const docs = await Document.find({ ...filter, status: 'ready' }, '_id name').lean();
  if (!docs.length) throw badRequest('No processed documents available to search');
  return docs.map((d) => String(d._id));
}

async function loadConversation(conversationId, documentIds) {
  if (conversationId) return Conversation.findById(conversationId);
  return Conversation.create({ documentIds, messages: [] });
}

/**
 * Full query path: retrieve, assemble, generate, validate, persist. `onText` switches generation
 * to streaming; the return value is the same either way.
 */
export async function answerQuestion({ question, documentIds = [], conversationId, onText, onSources }) {
  const ids = await resolveDocuments(documentIds);
  const conversation = await loadConversation(conversationId, ids);
  const history = (conversation?.messages || []).map((m) => ({ role: m.role, content: m.content }));
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const retrievalQuestion = question.split(/\s+/).length < 6 && lastUser ? `${lastUser.content} ${question}` : question;

  const retrieval = await retrieve(retrievalQuestion, { documentIds: ids });
  const context = await assembleContext(retrieval.chunks);
  const sources = context.sources.map(publicSource);
  onSources?.(sources);

  let text;
  let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  if (!context.sources.length) {
    text = NO_EVIDENCE;
    onText?.(text);
  } else if (onText) {
    ({ text, usage } = await streamAnswer(question, context.text, history, onText));
  } else {
    ({ text, usage } = await generateAnswer(question, context.text, history));
  }
  const validation = context.sources.length ? validateAnswer(text, context.sources, question) : { ok: true, refused: true, citedSources: [] };

  const citedIds = new Set(validation.citedSources);
  const citations = sources.filter((s) => citedIds.has(s.sourceId));
  await Conversation.updateOne({ _id: conversation._id }, { $push: { messages: {
    $each: [
      { role: 'user', content: question },
      { role: 'assistant', content: text, citations: citations.length ? citations : sources, validation, usage },
    ],
  } }, ...(conversation.title ? {} : { title: question.slice(0, 80) }) });

  return {
    conversationId: conversation._id, answer: text, citations, sources, validation, usage,
    retrieval: { analysis: retrieval.analysis, stats: retrieval.stats, filterRelaxed: retrieval.filterRelaxed },
  };
}
