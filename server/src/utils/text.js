import crypto from 'node:crypto';
import { getEncoding } from 'js-tiktoken';

let enc;
export function countTokens(text = '') {
  enc ??= getEncoding('cl100k_base');
  return enc.encode(text).length;
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function normalizeWhitespace(s = '') {
  return s.replace(/­/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Split into sentences without breaking on decimals ("3.5"), abbreviations or "U.S.". */
export function splitSentences(text) {
  const out = [];
  let buf = '';
  const tokens = text.split(/(\s+)/);
  for (const t of tokens) {
    buf += t;
    if (/[.!?]["')\]]?$/.test(t) && !/(?:\b[A-Z]|\b(?:Mr|Mrs|Dr|No|Inc|Corp|vs|etc|e\.g|i\.e|Fig|approx|Co|St))\.$/.test(t)) {
      const next = text.slice(text.indexOf(buf) + buf.length).trimStart()[0];
      if (!next || /[A-Z0-9"'(\[]/.test(next)) {
        out.push(buf.trim());
        buf = '';
      }
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

const STOP = new Set('a an and are as at be by for from has have how in is it its of on or that the this to was were what which who with does did do much many'.split(' '));
export function keywords(q = '') {
  return [...new Set(q.toLowerCase().match(/[a-z0-9][a-z0-9.%$-]*/g) || [])].filter((w) => !STOP.has(w) && w.length > 1);
}

/** Numbers as they appear in prose: 1,234  12.5%  $4.2 billion. Returned as bare numeric strings. */
export function extractNumbers(text = '') {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''));
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
