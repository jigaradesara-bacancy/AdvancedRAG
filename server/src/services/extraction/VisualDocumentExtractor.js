import { env } from '../../config/env.js';
import { Cache } from '../../models/index.js';
import { completeJson } from '../llm.service.js';
import { renderPagePng, savePageImage } from './pdfLoader.js';
import { extractNumbers, sha256 } from '../../utils/text.js';

const SYSTEM = `You extract structured data from one page of a PDF for a retrieval system.
Return ONLY a JSON object: {"elements":[...]}.
Each element: {
  "elementType": "chart" | "table" | "icon" | "image" | "diagram",
  "title": string,
  "description": one factual sentence,
  "categories": [labels] (charts),
  "series": [{"name": string, "values": [numbers or null]}] (charts),
  "unit": string or null,
  "columns": [headers] and "rows": [[cells]] (tables, keep units in headers or cells),
  "claims": [{"text": string, "value": string or null, "component": string or null, "footnoteMarkers": [string]}] (icon or callout claims such as "100% recycled aluminum" and the component they describe),
  "footnotes": [{"marker": string, "text": string, "appliesTo": string}]
}
Rules: copy numbers and units exactly as printed. If a value is not legible or not printed, use null. Never estimate values from bar heights. Do not add facts that are not on the page. Include footnotes that qualify any claim, link them through footnoteMarkers/appliesTo.`;

/** Vision-model extraction of charts, tables, icons and footnotes, cached by page-image hash. */
export class VisualDocumentExtractor {
  name = 'visual';

  async extractPage({ pdf, pageNumber, documentId, pageText }) {
    const { buffer, hash } = await renderPagePng(pdf, pageNumber, env.VISION_RENDER_SCALE);
    const imagePath = await savePageImage(documentId, pageNumber, buffer);
    const key = `vision:${env.LLM_VISION_MODEL}:${sha256(SYSTEM).slice(0, 8)}:${hash}`;
    let cached = await Cache.findOne({ key }).lean();
    let usage = { inputTokens: 0, outputTokens: 0, costUsd: 0, visionCalls: 0 };
    let json = cached?.value;
    if (!json) {
      const res = await completeJson({
        model: env.LLM_VISION_MODEL,
        system: SYSTEM,
        maxTokens: 6000,
        content: [
          { type: 'image', mediaType: 'image/png', base64: buffer.toString('base64') },
          { type: 'text', text: `Page ${pageNumber}. Extract every chart, table, icon claim and footnote.` },
        ],
      });
      json = res.json;
      usage = { ...res.usage, visionCalls: 1 };
      await Cache.updateOne({ key }, { $set: { value: json } }, { upsert: true });
    }
    const elements = (json.elements || []).map((e, i) => ({ ...e, id: `p${pageNumber}-e${i + 1}`, validation: validateAgainstText(e, pageText) }));
    return { elements, imagePath, imageHash: hash, usage, method: 'claude-vision' };
  }
}

/**
 * Cross-checks numbers the model read from the picture against numbers in the page's text layer.
 * A number with no match is flagged unverified rather than dropped, so it stays visible to the user.
 */
export function validateAgainstText(element, pageText = '') {
  const numbers = new Set(extractNumbers(pageText));
  const claimed = new Set();
  for (const s of element.series || []) (s.values || []).forEach((v) => v != null && claimed.add(String(v).replace(/,/g, '')));
  for (const r of element.rows || []) r.forEach((c) => extractNumbers(String(c ?? '')).forEach((n) => claimed.add(n)));
  for (const c of element.claims || []) extractNumbers(`${c.value ?? ''} ${c.text ?? ''}`).forEach((n) => claimed.add(n));
  const norm = (n) => String(Number(n));
  const textNums = new Set([...numbers].map(norm));
  const unverified = [...claimed].filter((n) => !textNums.has(norm(n)));
  return { checked: claimed.size, matched: claimed.size - unverified.length, unverified };
}
