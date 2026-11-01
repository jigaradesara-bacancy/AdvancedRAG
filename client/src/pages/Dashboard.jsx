import { Link } from 'react-router-dom';
import { api } from '../services/api.js';
import { useLoad } from '../hooks.js';
import UploadBox from '../components/UploadBox.jsx';
import { ErrorNote, ProgressBar, StatusBadge, TYPE_LABEL, fmtCost } from '../components/common.jsx';

const busy = (docs) => docs.some((d) => ['queued', 'processing'].includes(d.status));

export default function Dashboard() {
  const docs = useLoad(api.documents, [], { shouldPoll: busy });
  const stats = useLoad(api.stats, [], { shouldPoll: () => (docs.data ? busy(docs.data) : false) });
  const refresh = () => { docs.reload(); stats.reload(); };
  const s = stats.data;

  return (
    <div className="stack">
      <h1>Dashboard</h1>
      <ErrorNote message={docs.error || stats.error} />
      <section className="cards">
        <div className="card"><span className="label">Documents</span><span className="value">{s?.total ?? '-'}</span></div>
        <div className="card"><span className="label">Processed</span><span className="value">{s?.ready ?? '-'}</span></div>
        <div className="card"><span className="label">Failures</span><span className={`value ${s?.failed ? 'bad' : ''}`}>{s?.failed ?? '-'}</span></div>
        <div className="card"><span className="label">Indexed chunks</span><span className="value">{s?.chunks ?? '-'}</span></div>
        {/* <div className="card"><span className="label">Spend to date</span><span className="value">{s ? fmtCost(s.usage.costUsd) : '-'}</span><span className="muted small">{s ? `${(s.usage.visionCalls || 0)} vision calls, ${(s.usage.embeddingTokens || 0).toLocaleString()} embedding tokens` : ''}</span></div> */}
      </section>
      <UploadBox onUploaded={refresh} />
      <section className="panel">
        <h2>Documents</h2>
        {docs.data?.length === 0 && <p className="muted">No documents yet. Upload a PDF or place files in the data directory and scan.</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Detected type</th><th>Pages</th><th>Strategy</th><th>Status</th><th>Progress</th><th /></tr></thead>
            <tbody>
              {docs.data?.map((d) => (
                <tr key={d._id}>
                  <td><Link to={`/documents/${d._id}`}>{d.name}</Link></td>
                  <td>{d.classification?.type ? `${TYPE_LABEL[d.classification.type]}${d.strategyOverride ? ' (override)' : ''}` : '-'}</td>
                  <td>{d.pageCount ?? '-'}</td>
                  <td>{d.chunkStrategy ?? '-'}</td>
                  <td><StatusBadge status={d.status} />{d.error && <div className="small bad">{d.error}</div>}</td>
                  <td style={{ minWidth: 120 }}>{['queued', 'processing'].includes(d.status) ? <><ProgressBar value={d.progress} /><span className="small muted">{d.stage}</span></> : d.status === 'ready' ? `${d.chunkCount} chunks` : ''}</td>
                  <td className="actions">
                    <button className="btn small" disabled={['queued', 'processing'].includes(d.status)} onClick={async () => { await api.reprocess(d._id, { force: d.status !== 'failed' }); refresh(); }}>{d.status === 'failed' ? 'Resume' : 'Reprocess'}</button>
                    <button className="btn small danger" onClick={async () => { if (confirm(`Delete "${d.name}" and its indexed data?`)) { await api.remove(d._id); refresh(); } }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
