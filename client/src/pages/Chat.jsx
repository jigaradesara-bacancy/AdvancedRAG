import { useEffect, useRef, useState } from 'react';
import { api, streamChat } from '../services/api.js';
import { useLoad } from '../hooks.js';
import { SUGGESTED_QUESTIONS } from '../suggestions.js';
import SourceCard from '../components/SourceCard.jsx';
import Markdown from '../components/Markdown.jsx';
import { ErrorNote } from '../components/common.jsx';

function Message({ m }) {
  const [openIds, setOpenIds] = useState(new Set());
  const toggle = (id) => setOpenIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  if (m.role === 'user') return <div className="msg user">{m.content}</div>;
  const cited = new Set(m.validation?.citedSources || []);
  const shown = (m.sources || []).filter((s) => cited.has(s.sourceId));
  const others = (m.sources || []).filter((s) => !cited.has(s.sourceId));
  const v = m.validation;
  return (
    <div className="msg assistant">
      <Markdown text={m.content || (m.streaming ? '...' : '')} onCite={(id) => { toggle(id); document.getElementById(`src-${id}`)?.scrollIntoView({ block: 'nearest' }); }} />
      {v && !v.ok && !v.refused && (
        <div className="note note-warn small">
          Evidence check: {v.unsupportedNumbers?.length ? `these numbers were not found in the sources: ${v.unsupportedNumbers.join(', ')}. ` : ''}
          {v.invalidCitations?.length ? `Unknown citations: ${v.invalidCitations.join(', ')}. ` : ''}
          {!v.citedSources?.length ? 'The answer has no citations. ' : ''}Verify against the sources below.
        </div>
      )}
      {shown.length > 0 && <div className="sources"><h4>Sources</h4>{shown.map((s) => <SourceCard key={s.sourceId} source={s} cited open={openIds.has(s.sourceId)} onToggle={() => toggle(s.sourceId)} />)}</div>}
      {others.length > 0 && !m.streaming && (
        <details className="sources"><summary className="small muted">{others.length} other passages retrieved but not cited</summary>
          {others.map((s) => <SourceCard key={s.sourceId} source={s} open={openIds.has(s.sourceId)} onToggle={() => toggle(s.sourceId)} />)}
        </details>
      )}
      {m.usage && <div className="small muted">{m.usage.inputTokens} in / {m.usage.outputTokens} out tokens</div>}
    </div>
  );
}

export default function Chat() {
  const docs = useLoad(api.documents);
  const ready = (docs.data || []).filter((d) => d.status === 'ready');
  const [scope, setScope] = useState('all');
  const [selected, setSelected] = useState(new Set());
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const abort = useRef(null);
  const end = useRef(null);

  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  const documentIds = scope === 'all' ? [] : [...selected];
  const canAsk = !busy && input.trim().length > 1 && ready.length > 0 && (scope === 'all' || selected.size > 0);

  async function ask(question) {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setInput('');
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: q }, { role: 'assistant', content: '', streaming: true, sources: [] }]);
    const patch = (fn) => setMessages((m) => { const copy = [...m]; copy[copy.length - 1] = fn(copy[copy.length - 1]); return copy; });
    abort.current = new AbortController();
    try {
      await streamChat({ question: q, documentIds, conversationId: conversationId || undefined }, {
        signal: abort.current.signal,
        onSources: (sources) => patch((x) => ({ ...x, sources })),
        onToken: (t) => patch((x) => ({ ...x, content: x.content + t })),
        onDone: (r) => { setConversationId(r.conversationId); patch((x) => ({ ...x, content: r.answer, streaming: false, validation: r.validation, usage: r.usage, sources: r.sources })); },
      });
    } catch (e) {
      if (e.name !== 'AbortError') { setError(e.message); setMessages((m) => m.slice(0, -1)); }
      else patch((x) => ({ ...x, streaming: false }));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    abort.current?.abort();
    if (conversationId) await api.clearConversation(conversationId).catch(() => {});
    setMessages([]);
    setConversationId(null);
    setError(null);
  }

  return (
    <div className="chat-layout">
      <aside className="panel stack">
        <h2>Search scope</h2>
        <label className="radio"><input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} /> All documents</label>
        <label className="radio"><input type="radio" checked={scope === 'selected'} onChange={() => setScope('selected')} /> Selected documents</label>
        <div className={`doclist ${scope === 'all' ? 'disabled' : ''}`}>
          {ready.map((d) => (
            <label key={d._id} className="radio"><input type="checkbox" disabled={scope === 'all'} checked={selected.has(d._id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(d._id) ? n.delete(d._id) : n.add(d._id); return n; })} /> {d.name}</label>
          ))}
          {!ready.length && <p className="muted small">No processed documents yet.</p>}
        </div>
        <button className="btn" onClick={clear} disabled={!messages.length}>Clear conversation</button>
      </aside>
      <section className="chat">
        <div className="messages">
          {!messages.length && (
            <div className="suggest">
              <h2>Ask about your documents</h2>
              <p className="muted">Answers are generated only from retrieved passages and cite their pages. Try a question:</p>
              {SUGGESTED_QUESTIONS.map((q) => <button key={q} className="suggestion" disabled={!ready.length} onClick={() => ask(q)}>{q}</button>)}
            </div>
          )}
          {messages.map((m, i) => <Message key={i} m={m} />)}
          <div ref={end} />
        </div>
        <ErrorNote message={error} />
        <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <textarea rows={2} value={input} placeholder="Ask a question..." onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
          {busy ? <button type="button" className="btn" onClick={() => abort.current?.abort()}>Stop</button> : <button className="btn primary" disabled={!canAsk}>Ask</button>}
        </form>
      </section>
    </div>
  );
}
