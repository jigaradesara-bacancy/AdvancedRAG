import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { countTokens } from '../utils/text.js';
import { logger } from '../utils/logger.js';

/**
 * Provider-neutral chat. Messages use one shape: { role, content } where content is a string or a
 * list of { type: 'text', text } and { type: 'image', base64, mediaType } parts. Gemini, Ollama and
 * other OpenAI-compatible servers share one implementation; Anthropic has its own.
 */

export function costOf({ inputTokens = 0, outputTokens = 0 }) {
  return (inputTokens * env.LLM_INPUT_PRICE_PER_MTOK + outputTokens * env.LLM_OUTPUT_PRICE_PER_MTOK) / 1e6;
}

const asParts = (c) => (typeof c === 'string' ? [{ type: 'text', text: c }] : c);

function requireKey() {
  if (env.LLM_PROVIDER !== 'ollama' && !env.LLM_API_KEY) {
    const hint = env.LLM_PROVIDER === 'gemini' ? 'GEMINI_API_KEY (free key from Google AI Studio)' : env.LLM_PROVIDER === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'LLM_API_KEY';
    throw new AppError(`${hint} is not configured`, 503, 'LLM_NOT_CONFIGURED');
  }
  if (!env.LLM_ANSWER_MODEL) throw new AppError('LLM_ANSWER_MODEL is not configured', 503, 'LLM_NOT_CONFIGURED');
}

/**
 * fetch with retry on 429/5xx; free tiers rate-limit, so honour Retry-After and back off.
 * The timer covers time to the response headers. For streams, call res.kick() on every chunk to turn
 * it into an idle timeout, and res.stopWatch() when done, so a long answer is never cut off mid-stream.
 */
export async function fetchWithRetry(url, init, { retries = 6, label = 'request', timeoutMs = env.LLM_TIMEOUT_MS, idleMs = env.LLM_IDLE_TIMEOUT_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    let timer;
    const arm = (ms) => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
    };
    arm(timeoutMs);
    let res;
    try {
      res = await fetch(url, { ...init, signal: controller.signal });
    } catch (err) {
      clearTimeout(timer);
      if (timedOut) {
        const e = new AppError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s with no response from the provider`, 502, 'PROVIDER_TIMEOUT');
        e.upstreamStatus = 504;
        if (attempt >= 1) throw e;
        continue;
      }
      if (attempt >= retries) throw new AppError(`${label} failed: ${err.cause?.code || err.message}. Is the provider reachable?`, 502, 'PROVIDER_UNREACHABLE');
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    clearTimeout(timer);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(retryAfter) && res.headers.has('retry-after') ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 30000);
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const err = new AppError(`${label} failed (${res.status}): ${(await res.text()).slice(0, 300)}`, 502, 'PROVIDER_ERROR');
      err.upstreamStatus = res.status;
      throw err;
    }
    res.kick = () => arm(idleMs);
    res.stopWatch = () => clearTimeout(timer);
    return res;
  }
}

function toOpenAiMessages(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    const parts = asParts(m.content);
    out.push({
      role: m.role,
      content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts.map((p) => (p.type === 'image'
        ? { type: 'image_url', image_url: { url: `data:${p.mediaType};base64,${p.base64}` } }
        : { type: 'text', text: p.text })),
    });
  }
  return out;
}

async function openAiChat({ model, system, messages, maxTokens, onText, retries }) {
  const res = await fetchWithRetry(`${env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({
      model, messages: toOpenAiMessages(system, messages), max_tokens: maxTokens, temperature: 0,
      ...(env.LLM_REASONING_EFFORT ? { reasoning_effort: env.LLM_REASONING_EFFORT } : {}),
      ...(onText ? { stream: true, stream_options: { include_usage: true } } : {}),
    }),
  }, { label: `${env.LLM_PROVIDER} chat`, retries });

  if (!onText) {
    const body = await res.json();
    const u = body.usage || {};
    return { text: body.choices?.[0]?.message?.content ?? '', usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 } };
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let usage = null;
  res.kick();
  for await (const chunk of res.body) {
    res.kick();
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      const evt = JSON.parse(line.slice(5));
      const delta = evt.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onText(delta); }
      if (evt.usage) usage = { inputTokens: evt.usage.prompt_tokens ?? 0, outputTokens: evt.usage.completion_tokens ?? 0 };
    }
  }
  res.stopWatch();
  return { text, usage: usage ?? { inputTokens: countTokens(JSON.stringify(messages) + (system || '')), outputTokens: countTokens(text) } };
}

let anthropicClient;
async function anthropicChat({ model, system, messages, maxTokens, onText }) {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: env.LLM_API_KEY });
  }
  const converted = messages.map((m) => ({
    role: m.role,
    content: typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.base64 } }
      : { type: 'text', text: p.text })),
  }));
  const params = { model, max_tokens: maxTokens, system, messages: converted };
  let final;
  if (onText) {
    const stream = anthropicClient.messages.stream(params);
    stream.on('text', onText);
    final = await stream.finalMessage();
  } else {
    final = await anthropicClient.messages.create(params);
  }
  return {
    text: final.content.filter((b) => b.type === 'text').map((b) => b.text).join(''),
    usage: { inputTokens: final.usage?.input_tokens ?? 0, outputTokens: final.usage?.output_tokens ?? 0 },
  };
}

const SWITCH_MODEL_STATUSES = new Set([404, 429, 500, 502, 503, 504]);

/**
 * Returns { text, usage: { inputTokens, outputTokens, costUsd } }. Pass onText to stream.
 * When a model is overloaded, rate limited or retired, the next model in LLM_FALLBACK_MODELS is
 * tried. Failures happen at the HTTP status, before any token streams, so switching is safe.
 */
export async function chat({ model = env.LLM_ANSWER_MODEL, system, messages, maxTokens = env.LLM_MAX_TOKENS, onText }) {
  requireKey();
  const run = env.LLM_PROVIDER === 'anthropic' ? anthropicChat : openAiChat;
  const candidates = [model, ...env.LLM_FALLBACK_MODELS.filter((m) => m !== model)];
  let lastError;
  for (const [i, candidate] of candidates.entries()) {
    try {
      const retries = i === candidates.length - 1 ? 6 : 2;
      const { text, usage } = await run({ model: candidate, system, messages, maxTokens, onText, retries });
      if (i > 0) logger.warn({ model, used: candidate }, 'primary model unavailable, used fallback');
      return { text, usage: { ...usage, costUsd: costOf(usage), model: candidate } };
    } catch (err) {
      lastError = err;
      if (!SWITCH_MODEL_STATUSES.has(err.upstreamStatus)) throw err;
      logger.warn({ model: candidate, status: err.upstreamStatus }, 'model failed, trying next');
    }
  }
  throw lastError;
}

/** Extract the first JSON object from a model reply, tolerating code fences. */
export function parseJsonReply(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('no JSON object in model reply');
  return JSON.parse(body.slice(start, end + 1));
}

export async function completeJson({ model, system, content, maxTokens = 4000 }) {
  const { text, usage } = await chat({ model, system, maxTokens, messages: [{ role: 'user', content }] });
  return { json: parseJsonReply(text), usage };
}
