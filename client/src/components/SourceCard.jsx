import { api } from '../services/api.js';

export default function SourceCard({ source, open, onToggle, cited }) {
  const where = [source.chapter, source.section, source.subsection].filter(Boolean).join(' > ');
  return (
    <article className={`source ${cited ? 'cited' : ''}`} id={`src-${source.sourceId}`}>
      <button className="source-head" onClick={onToggle} aria-expanded={open}>
        <span className="chip">{source.sourceId}</span>
        <span className="source-title">
          <strong>{source.documentName}</strong>, {source.sourceReference || `Page ${source.pageNumber}`}
          {source.elementType ? ` - ${source.elementType}` : ''}
        </span>
        <span className="muted small">{open ? 'Hide' : 'Show evidence'}</span>
      </button>
      {where && <div className="small muted source-where">{where}</div>}
      {open && (
        <div className="source-body">
          <pre className="text">{source.evidence}</pre>
          <a className="small" href={`${api.fileUrl(source.documentId)}#page=${source.pageNumber}`} target="_blank" rel="noreferrer">Open PDF at page {source.pageNumber}</a>
        </div>
      )}
    </article>
  );
}
