import { describe, it, expect, vi, afterEach } from 'vitest';
import { env } from '../src/config/env.js';
import { chat, parseJsonReply } from '../src/services/llm.service.js';
import { fitDimensions } from '../src/services/embedding.service.js';

afterEach(() => vi.unstubAllGlobals());

const sse = (events) => new ReadableStream({
  start(c) {
    events.forEach((e) => c.enqueue(new TextEncoder().encode(`data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`)));
    c.close();
  },
});

describe('provider presets', () => {
  it('defaults to the free Gemini endpoint with models and embeddings filled in', () => {
    expect(env.LLM_PROVIDER).toBe('gemini');
    expect(env.LLM_BASE_URL).toContain('generativelanguage.googleapis.com');
    expect(env.LLM_ANSWER_MODEL).toBeTruthy();
    expect(env.EMBEDDING_DIMENSIONS).toBe(768);
  });
});

describe('chat (OpenAI-compatible)', () => {
  it('sends images as data URIs and returns text and usage', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'hello' } }], usage: { prompt_tokens: 12, completion_tokens: 3 } })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await chat({ system: 'sys', messages: [{ role: 'user', content: [{ type: 'image', mediaType: 'image/png', base64: 'AAAA' }, { type: 'text', text: 'what?' }] }] });
    expect(r.text).toBe('hello');
    expect(r.usage).toMatchObject({ inputTokens: 12, outputTokens: 3 });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1].content[0].image_url.url).toBe('data:image/png;base64,AAAA');
  });

  it('streams tokens and reads final usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sse([
      { choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: { content: 'lo' } }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }, '[DONE]',
    ]))));
    const seen = [];
    const r = await chat({ messages: [{ role: 'user', content: 'hi' }], onText: (t) => seen.push(t) });
    expect(seen).toEqual(['Hel', 'lo']);
    expect(r.text).toBe('Hello');
    expect(r.usage.outputTokens).toBe(2);
  });

  it('retries after a 429 and then succeeds', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('slow down', { status: 429, headers: { 'retry-after': '0' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    expect((await chat({ messages: [{ role: 'user', content: 'hi' }] })).text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('helpers', () => {
  it('parses JSON out of fenced replies', () => {
    expect(parseJsonReply('Here:\n```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('truncates and renormalises longer embeddings, rejects shorter ones', () => {
    const v = fitDimensions([3, 4, 12, 0], 2);
    expect(v[0] ** 2 + v[1] ** 2).toBeCloseTo(1);
    expect(() => fitDimensions([1, 2], 4)).toThrow(/dimensions/);
  });
});

describe('model fallback', () => {
  it('moves to the next model when the first is overloaded', async () => {
    env.LLM_FALLBACK_MODELS.splice(0, env.LLM_FALLBACK_MODELS.length, 'backup-model');
    const fetchMock = vi.fn(async (url, init) => (JSON.parse(init.body).model === env.LLM_ANSWER_MODEL
      ? new Response('overloaded', { status: 503, headers: { 'retry-after': '0' } })
      : new Response(JSON.stringify({ choices: [{ message: { content: 'from backup' } }] }))));
    vi.stubGlobal('fetch', fetchMock);
    const r = await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(r.text).toBe('from backup');
    expect(r.usage.model).toBe('backup-model');
  });
  it('does not switch models on a client error such as 400', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    await expect(chat({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/400/);
  });
});

describe('timeouts and reasoning', () => {
  it('sends reasoning_effort for Gemini', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' } }] })));
    vi.stubGlobal('fetch', fetchMock);
    await chat({ messages: [{ role: 'user', content: 'hi' }] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('low');
  });

  it('turns a hung request into a timeout and falls back to the next model', async () => {
    env.LLM_FALLBACK_MODELS.splice(0, env.LLM_FALLBACK_MODELS.length, 'backup-model');
    const original = env.LLM_TIMEOUT_MS;
    env.LLM_TIMEOUT_MS = 50;
    const hang = (init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    vi.stubGlobal('fetch', vi.fn(async (url, init) => (JSON.parse(init.body).model === env.LLM_ANSWER_MODEL
      ? hang(init) : new Response(JSON.stringify({ choices: [{ message: { content: 'fast' } }] })))));
    try {
      const r = await chat({ messages: [{ role: 'user', content: 'hi' }] });
      expect(r.usage.model).toBe('backup-model');
    } finally {
      env.LLM_TIMEOUT_MS = original;
    }
  });
});
