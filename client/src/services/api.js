async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json', ...options.headers } : options.headers,
    body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `Request failed (${res.status})`);
  return data;
}

export const api = {
  stats: () => request('/stats'),
  documents: () => request('/documents'),
  document: (id) => request(`/documents/${id}`),
  status: (id) => request(`/documents/${id}/status`),
  upload: (file) => {
    const form = new FormData();
    form.append('file', file);
    return request('/documents/upload', { method: 'POST', body: form });
  },
  scan: () => request('/documents/scan', { method: 'POST' }),
  reprocess: (id, body) => request(`/documents/${id}/process`, { method: 'POST', body }),
  remove: (id) => request(`/documents/${id}`, { method: 'DELETE' }),
  extraction: (id, page = 1) => request(`/documents/${id}/extraction?page=${page}&limit=10`),
  chunks: (id, params) => request(`/documents/${id}/chunks?${new URLSearchParams(params)}`),
  structure: (id) => request(`/documents/${id}/structure`),
  visualElements: (id) => request(`/documents/${id}/visual-elements`),
  history: () => request('/chat/history'),
  conversation: (id) => request(`/chat/history?id=${id}`),
  clearConversation: (id) => request(`/chat/history/${id}`, { method: 'DELETE' }),
  evalCases: () => request('/evaluation/cases'),
  evalRuns: () => request('/evaluation/runs'),
  runEval: () => request('/evaluation/run', { method: 'POST', body: {} }),
  pageImageUrl: (id, n) => `/api/documents/${id}/pages/${n}/image`,
  fileUrl: (id) => `/api/documents/${id}/file`,
};

/** POSTs a question and reads the server-sent event stream (EventSource cannot POST). */
export async function streamChat(body, { onSources, onToken, onDone, signal }) {
  const res = await fetch('/api/chat/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error?.message || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = raw.match(/^event: (.*)$/m)?.[1];
      const data = raw.match(/^data: (.*)$/m)?.[1];
      if (!event || !data) continue;
      const payload = JSON.parse(data);
      if (event === 'sources') onSources?.(payload);
      else if (event === 'token') onToken?.(payload);
      else if (event === 'done') onDone?.(payload);
      else if (event === 'error') throw new Error(payload.message);
    }
  }
}
