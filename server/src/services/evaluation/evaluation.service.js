import fs from 'node:fs/promises';
import path from 'node:path';
import { Document, VisualElement, EvalRun } from '../../models/index.js';
import { paths } from '../../config/env.js';
import { answerQuestion } from '../rag.service.js';
import * as m from './metrics.js';

const K = 8;

export async function loadCases() {
  const raw = JSON.parse(await fs.readFile(path.join(paths.serverRoot, 'evaluation/cases.json'), 'utf8'));
  return raw.cases;
}

async function runCase(c, docs) {
  const scope = c.documentMatch ? docs.filter((d) => d.name.toLowerCase().includes(c.documentMatch.toLowerCase())) : docs;
  if (c.documentMatch && !scope.length) return { id: c.id, question: c.question, skipped: `no ready document matches "${c.documentMatch}"` };

  const started = Date.now();
  const res = await answerQuestion({ question: c.question, documentIds: scope.map((d) => String(d._id)) });
  const retrieved = res.sources.filter((s) => !s.isParentContext);
  const elements = c.expectedElements?.length ? await VisualElement.find({ documentId: { $in: scope.map((d) => d._id) } }).lean() : [];
  const wrongDocument = scope.length && retrieved.some((s) => !scope.some((d) => String(d._id) === String(s.documentId)));

  const metrics = {
    precisionAtK: m.precisionAtK(retrieved, c.expectedPages, K),
    recallAtK: m.recallAtK(retrieved, c.expectedPages, K),
    answerCorrectness: m.answerCorrectness(res.answer, c.expectedFacts),
    faithfulness: m.faithfulness(res.validation),
    citationCorrectness: m.citationCorrectness(res.validation, res.citations, c.expectedPages),
    isolation: m.isolationScore(retrieved, c.isolation),
    visualExtraction: m.visualExtractionAccuracy(c.expectedElements, elements),
    correctSource: scope.length ? (wrongDocument ? 0 : 1) : null,
    refusalHandled: c.shouldRefuse ? (res.validation.refused ? 1 : 0) : (res.validation.refused ? 0 : null),
  };
  return {
    id: c.id, question: c.question, answer: res.answer, metrics,
    unscored: !c.expectedFacts?.length && !c.expectedPages?.length && !c.shouldRefuse,
    latencyMs: Date.now() - started, usage: res.usage,
    retrievedPages: retrieved.map((s) => ({ doc: s.documentName, page: s.pageNumber, type: s.chunkType })),
  };
}

export async function runEvaluation({ caseIds } = {}) {
  const docs = await Document.find({ status: 'ready' }, '_id name').lean();
  const cases = (await loadCases()).filter((c) => !caseIds?.length || caseIds.includes(c.id));
  const results = [];
  for (const c of cases) {
    try {
      results.push(await runCase(c, docs));
    } catch (err) {
      results.push({ id: c.id, question: c.question, error: err.message });
    }
  }
  const ok = results.filter((r) => r.metrics);
  const summary = {
    cases: results.length, evaluated: ok.length, unscored: ok.filter((r) => r.unscored).length,
    skipped: results.filter((r) => r.skipped).length, errored: results.filter((r) => r.error).length,
    ...Object.fromEntries(Object.keys(ok[0]?.metrics || {}).map((k) => [k, m.mean(ok.map((r) => r.metrics[k]))])),
  };
  return EvalRun.create({ summary, results });
}
