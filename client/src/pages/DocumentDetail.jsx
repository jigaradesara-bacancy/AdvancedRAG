import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../services/api.js';
import { useLoad } from '../hooks.js';
import { ErrorNote, ProgressBar, StatusBadge, TYPE_LABEL, fmtCost } from '../components/common.jsx';

const TABS = ['Overview', 'Extracted text', 'Structure', 'Chunks', 'Visual elements', 'Metadata'];
const active = (d) => ['queued', 'processing'].includes(d.status);

export default function DocumentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState('Overview');
  const [override, setOverride] = useState('');
  const doc = useLoad(() => api.document(id), [id], { shouldPoll: active });

  if (doc.error) return <ErrorNote message={doc.error} />;
  const d = doc.data;
  if (!d) return <p className="muted">Loading...</p>;

  async function reprocess() {
    await api.reprocess(id, override ? { force: true, strategyOverride: override } : { force: true });
    doc.reload();
  }

  return (
    <div className="stack">
      <p><Link to="/">&larr; Dashboard</Link></p>
      <div className="row between">
        <h1>{d.name}</h1>
        <StatusBadge status={d.status} />
      </div>
      {active(d) && <><ProgressBar value={d.progress} /><p className="muted small">Stage: {d.stage}</p></>}
      <ErrorNote message={d.error} />
      <div className="tabs">{TABS.map((t) => <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === 'Overview' && (
        <section className="panel stack">
          <dl className="kv">
            <dt>Detected type</dt><dd>{TYPE_LABEL[d.classification?.signals?.detectedType] || '-'} {d.classification?.confidence != null && <span className="muted">(confidence {d.classification.confidence})</span>}</dd>
            <dt>Active type</dt><dd>{TYPE_LABEL[d.classification?.type] || '-'}{d.strategyOverride ? ' (manual override)' : ''}</dd>
            <dt>Chunking strategy</dt><dd>{d.chunkStrategy || '-'}</dd>
            <dt>Pages</dt><dd>{d.pageCount ?? '-'} ({d.extractedPages} extracted)</dd>
            <dt>Chunks / visual elements</dt><dd>{d.chunkCount} / {d.visualElementCount}</dd>
            <dt>Processing version</dt><dd>{d.processingVersion ?? '-'}</dd>
            <dt>Usage</dt><dd>{d.usage?.embeddingTokens?.toLocaleString()} embedding tokens, {d.usage?.visionCalls} vision calls, {d.usage?.inputTokens?.toLocaleString()} in / {d.usage?.outputTokens?.toLocaleString()} out, {fmtCost(d.usage?.costUsd)}</dd>
          </dl>
          <div className="row">
            <select value={override} onChange={(e) => setOverride(e.target.value)} aria-label="Strategy override">
              <option value="">Automatic strategy</option>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>Force: {v}</option>)}
            </select>
            <button className="btn primary" disabled={active(d)} onClick={reprocess}>Reprocess</button>
            <a className="btn" href={api.fileUrl(id)} target="_blank" rel="noreferrer">Open PDF</a>
            <button className="btn danger" onClick={async () => { if (confirm('Delete this document?')) { await api.remove(id); nav('/'); } }}>Delete</button>
          </div>
        </section>
      )}
      {tab === 'Extracted text' && <TextTab id={id} />}
      {tab === 'Structure' && <StructureTab id={id} />}
      {tab === 'Chunks' && <ChunksTab id={id} />}
      {tab === 'Visual elements' && <VisualTab id={id} />}
      {tab === 'Metadata' && <section className="panel"><pre className="json">{JSON.stringify({ classification: d.classification, sha256: d.sha256, source: d.source, sizeBytes: d.sizeBytes, completedStages: d.completedStages }, null, 2)}</pre></section>}
    </div>
  );
}

function Pager({ page, total, limit, onChange }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="row">
      <button className="btn small" disabled={page <= 1} onClick={() => onChange(page - 1)}>Prev</button>
      <span className="muted small">Page {page} of {pages} ({total} items)</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </div>
  );
}

function TextTab({ id }) {
  const [page, setPage] = useState(1);
  const r = useLoad(() => api.extraction(id, page), [id, page]);
  return (
    <section className="panel stack">
      <ErrorNote message={r.error} />
      {r.data && <Pager page={page} total={r.data.total} limit={r.data.limit} onChange={setPage} />}
      {r.data?.pages.map((p) => (
        <article key={p.pageNumber} className="evidence">
          <div className="small muted">Page {p.pageNumber} - {p.extractors?.join(', ')} - {p.charCount} chars{p.imagePath ? ' - rendered for vision' : ''}</div>
          <pre className="text">{p.text || '(no text)'}</pre>
        </article>
      ))}
    </section>
  );
}

function StructureTab({ id }) {
  const r = useLoad(() => api.structure(id), [id]);
  if (r.error) return <ErrorNote message={r.error} />;
  if (!r.data) return <p className="muted">Loading...</p>;
  if (!r.data.chapters.length) return <p className="muted panel">No heading structure was detected. This view is populated by the hierarchical strategy.</p>;
  return (
    <section className="panel stack">
      {r.data.chapters.map((c) => (
        <details key={c.title} open={c.sections.length > 0}>
          <summary><strong>{c.title}</strong> <span className="muted small">from p.{c.firstPage}</span></summary>
          <ul>
            {c.sections.map((s) => (
              <li key={s.title}>{s.title} <span className="muted small">p.{s.firstPage}{s.region ? ` - ${s.region}` : ''}</span>
                {s.subsections.length > 0 && <ul>{s.subsections.map((x) => <li key={x} className="small">{x}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </section>
  );
}

const CHUNK_TYPES = ['', 'paragraph', 'parent', 'child', 'table', 'chart', 'icon', 'footnote', 'ocr'];

function ChunksTab({ id }) {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const r = useLoad(() => api.chunks(id, { page, limit: 20, ...(type && { type }), ...(q && { q }) }), [id, page, type, q]);
  return (
    <section className="panel stack">
      <div className="row">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Chunk type">{CHUNK_TYPES.map((t) => <option key={t} value={t}>{t || 'All types'}</option>)}</select>
        <input placeholder="Search chunk text" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        {r.data && <span className="muted small">Vector backend: {r.data.backend}</span>}
      </div>
      <ErrorNote message={r.error} />
      {r.data && <Pager page={page} total={r.data.total} limit={r.data.limit} onChange={setPage} />}
      {r.data?.items.map((c) => (
        <article key={c.chunkId} className="evidence">
          <div className="small muted">{c.chunkType} - p.{c.pageNumber}{c.pageEnd && c.pageEnd !== c.pageNumber ? `-${c.pageEnd}` : ''} - {c.tokenCount} tokens{c.region ? ` - ${c.region}` : ''}</div>
          {(c.chapter || c.section) && <div className="small">{[c.chapter, c.section, c.subsection].filter(Boolean).join(' > ')}</div>}
          <pre className="text">{c.content}</pre>
          {c.parentChunkId && <div className="small muted">parent: {c.parentChunkId}</div>}
        </article>
      ))}
    </section>
  );
}

function VisualTab({ id }) {
  const r = useLoad(() => api.visualElements(id), [id]);
  if (r.error) return <ErrorNote message={r.error} />;
  if (!r.data) return <p className="muted">Loading...</p>;
  if (!r.data.length) return <p className="muted panel">No tables, charts or icons were extracted from this document.</p>;
  return (
    <section className="panel stack">
      {r.data.map((e) => (
        <article key={e._id} className="evidence">
          <div className="row between">
            <strong>{e.sourceReference}</strong>
            <span className="small muted">{e.extractionMethod}</span>
          </div>
          {e.validation?.unverified?.length > 0 && <div className="note note-warn small">Not found in the page text layer, treat as unverified: {e.validation.unverified.join(', ')}</div>}
          {e.footnotes?.length > 0 && <ul className="small">{e.footnotes.map((f, i) => <li key={i}>[{f.marker}] {f.text}</li>)}</ul>}
          <pre className="json">{JSON.stringify(e.data, null, 2)}</pre>
          <a className="small" href={api.pageImageUrl(id, e.pageNumber)} target="_blank" rel="noreferrer">View rendered page {e.pageNumber}</a>
        </article>
      ))}
    </section>
  );
}
