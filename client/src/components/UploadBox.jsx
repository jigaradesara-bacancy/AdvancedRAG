import { useRef, useState } from 'react';
import { api } from '../services/api.js';

export default function UploadBox({ onUploaded }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [over, setOver] = useState(false);

  async function send(files) {
    setBusy(true);
    setMessage(null);
    for (const file of files) {
      try {
        await api.upload(file);
      } catch (e) {
        setMessage(`${file.name}: ${e.message}`);
      }
    }
    setBusy(false);
    onUploaded?.();
  }

  return (
    <div
      className={`upload ${over ? 'over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); send([...e.dataTransfer.files]); }}
    >
      <input ref={input} type="file" accept="application/pdf" multiple hidden onChange={(e) => send([...e.target.files])} />
      <p><strong>Drop PDFs here</strong> or</p>
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => input.current.click()}>{busy ? 'Uploading...' : 'Choose files'}</button>
        <button className="btn" disabled={busy} onClick={async () => { const r = await api.scan(); setMessage(`Scanned data directory: ${r.added.length} added, ${r.skipped.length} already indexed`); onUploaded?.(); }}>Scan data directory</button>
      </div>
      {message && <p className="muted small">{message}</p>}
    </div>
  );
}
