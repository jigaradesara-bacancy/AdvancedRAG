export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{status}</span>;
}

export function ProgressBar({ value = 0 }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div style={{ width: `${value}%` }} />
    </div>
  );
}

export function ErrorNote({ message }) {
  return message ? <div className="note note-error">{message}</div> : null;
}

export const TYPE_LABEL = { plain: 'Plain text', structured: 'Long structured', visual: 'Visually complex', scanned: 'Scanned', mixed: 'Mixed' };
export const fmtCost = (n) => (n ? `$${n.toFixed(4)}` : '$0');
