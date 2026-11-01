import { env } from '../config/env.js';
import { chat } from './llm.service.js';
import { extractNumbers } from '../utils/text.js';

export const SYSTEM_PROMPT = `You answer questions about documents using only the numbered sources provided in the user message.

Rules:
- Use only the provided sources. Never add outside facts, and never invent numbers or percentages.
- Copy numbers, units and names exactly as written in the sources.
- If the sources do not contain enough evidence, say exactly: "The answer cannot be determined from the available document content." and briefly say what is missing.
- If sources give conflicting values, report each with its source and explain the difference; do not pick one without justification.
- Start with a one or two sentence short answer, then a "Details" section with supporting points.
- Cite every factual claim with its source id in square brackets, like [S1] or [S2][S4]. Mention page numbers and section or element names where useful.
- Separate what the document states directly from values you calculate. For a calculation, write "(calculated)", show the formula and the source values.
- Treat a table or chart in the sources as structured data: keep its units. Values marked "not stated" or unverified must not be guessed.
- Prefer sources from the section, chapter or region the question asks about, and do not mix regions or chapters.`;

function buildMessages(question, context, history) {
  const prior = history.slice(-4).map((m) => ({ role: m.role, content: m.content }));
  return [...prior, { role: 'user', content: `Sources:\n\n${context}\n\n---\nQuestion: ${question}` }];
}

export function generateAnswer(question, context, history = []) {
  return chat({ model: env.LLM_ANSWER_MODEL, system: SYSTEM_PROMPT, messages: buildMessages(question, context, history) });
}

export function streamAnswer(question, context, history, onText) {
  return chat({ model: env.LLM_ANSWER_MODEL, system: SYSTEM_PROMPT, messages: buildMessages(question, context, history), onText });
}

const normalizeNumber = (n) => String(Number(n));

/**
 * Checks the answer against its evidence: every cited id must exist, and every number must occur
 * in the sources unless the sentence is labelled as a calculation. Numbers from the question
 * itself and citation markers are ignored.
 */
export function validateAnswer(answer, sources, question = '') {
  const ids = new Set(sources.map((s) => s.sourceId));
  const cited = [...new Set([...answer.matchAll(/\[(S\d+)\]/g)].map((m) => m[1]))];
  const invalidCitations = cited.filter((c) => !ids.has(c));
  const evidenceNumbers = new Set(extractNumbers(sources.map((s) => s.content).join(' ')).map(normalizeNumber));
  const questionNumbers = new Set(extractNumbers(question).map(normalizeNumber));

  const unsupported = [];
  const calculated = [];
  const sentences = answer.replace(/\[S\d+\]/g, '').split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    const isCalc = /calculated|formula|difference|=/.test(sentence);
    for (const n of extractNumbers(sentence).map(normalizeNumber)) {
      if (evidenceNumbers.has(n) || questionNumbers.has(n)) continue;
      (isCalc ? calculated : unsupported).push(n);
    }
  }
  const refusal = /cannot be determined/i.test(answer);
  return {
    ok: invalidCitations.length === 0 && unsupported.length === 0 && (cited.length > 0 || refusal),
    citedSources: cited,
    invalidCitations,
    unsupportedNumbers: [...new Set(unsupported)],
    calculatedNumbers: [...new Set(calculated)],
    refused: refusal,
  };
}
