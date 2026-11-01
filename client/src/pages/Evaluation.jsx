import { useState } from 'react';
import { api } from '../services/api.js';
import { useLoad } from '../hooks.js';
import { ErrorNote } from '../components/common.jsx';

const METRICS = [['precisionAtK', 'Precision@K'], ['recallAtK', 'Recall@K'], ['answerCorrectness', 'Answer correctness'], ['faithfulness', 'Faithfulness'], ['citationCorrectness', 'Citation correctness'], ['isolation', 'Region/chapter isolation'], ['visualExtraction', 'Visual extraction'], ['correctSource', 'Correct source'], ['refusalHandled', 'Missing-info handling']];
const pct = (v) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);

export default function Evaluation() {
  const cases = useLoad(api.evalCases);
  const runs = useLoad(api.evalRuns);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const latest = runs.data?.[0];
  const configured = (cases.data || []).filter((c) => c.expectedFacts?.length || c.expectedPages?.length || c.shouldRefuse).length;

  return (
    <div className="stack">
      <div className="row between">
        <h1>Evaluation</h1>
        <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); setError(null); try { await api.runEval(); await runs.reload(); } catch (e) { setError(e.message); } setBusy(false); }}>{busy ? 'Running...' : 'Run evaluation'}</button>
      </div>
      <p className="muted">{cases.data?.length ?? 0} cases, {configured} with expectations configured. Edit <code>server/evaluation/cases.json</code> to add expected facts and pages. Cases without expectations are reported as unscored, not passed. "n/a" means no ground truth was configured for that metric.</p>
      <ErrorNote message={error || runs.error} />
      {latest && (
        <section className="panel stack">
          <h2>Latest run <span className="muted small">{new Date(latest.createdAt).toLocaleString()}</span></h2>
          <div className="cards">{METRICS.map(([k, label]) => <div key={k} className="card"><span className="label">{label}</span><span className="value">{pct(latest.summary[k])}</span></div>)}</div>
          <div className="table-wrap"><table>
            <thead><tr><th>Case</th><th>Question</th><th>State</th><th>Answer</th></tr></thead>
            <tbody>{latest.results.map((r) => (
              <tr key={r.id}><td>{r.id}</td><td>{r.question}</td>
                <td>{r.error ? 'error' : r.skipped ? 'skipped' : r.unscored ? 'unscored' : 'scored'}</td>
                <td className="small">{r.error || r.skipped || r.answer?.slice(0, 240)}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}
    </div>
  );
}
