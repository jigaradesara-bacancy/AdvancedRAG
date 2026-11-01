import { Fragment } from 'react';

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*\s][^*]*\*|\[S\d+\])/g;

/** Inline spans: bold, italic, code and [S#] citation buttons. Everything else stays plain text. */
function Inline({ text, onCite }) {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    const cite = part.match(/^\[(S\d+)\]$/);
    if (cite) return <button key={i} className="chip inline" onClick={() => onCite?.(cite[1])}>{cite[1]}</button>;
    if (/^(\*\*|__)/.test(part)) return <strong key={i}><Inline text={part.slice(2, -2)} onCite={onCite} /></strong>;
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>;
    if (/^\*[^*\s]/.test(part)) return <em key={i}><Inline text={part.slice(1, -1)} onCite={onCite} /></em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const splitRow = (line) => line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isSeparator = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

/** Parses the subset of Markdown models actually emit into blocks. */
export function parseBlocks(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const h = line.match(HEADING);
    if (h) { blocks.push({ type: 'heading', level: Math.min(h[1].length + 1, 5), text: h[2].replace(/\s*#+\s*$/, '') }); i++; continue; }
    if (isTableRow(line) && lines[i + 1] && isSeparator(lines[i + 1])) {
      const head = splitRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      blocks.push({ type: 'table', head, rows });
      continue;
    }
    const kind = BULLET.test(line) ? 'ul' : NUMBERED.test(line) ? 'ol' : null;
    if (kind) {
      const re = kind === 'ul' ? BULLET : NUMBERED;
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(re);
        if (m) items.push(m[1]);
        else if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) items[items.length - 1] += ` ${lines[i].trim()}`;
        else break;
        i++;
      }
      blocks.push({ type: kind, items });
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !HEADING.test(lines[i]) && !BULLET.test(lines[i]) && !NUMBERED.test(lines[i]) && !isTableRow(lines[i])) para.push(lines[i++].trim());
    blocks.push({ type: 'p', text: para.join(' ') });
  }
  return blocks;
}

export default function Markdown({ text, onCite }) {
  return (
    <div className="md">
      {parseBlocks(text).map((b, i) => {
        if (b.type === 'heading') { const H = `h${b.level}`; return <H key={i}><Inline text={b.text} onCite={onCite} /></H>; }
        if (b.type === 'ul' || b.type === 'ol') {
          const List = b.type;
          return <List key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} onCite={onCite} /></li>)}</List>;
        }
        if (b.type === 'table') {
          return (
            <div key={i} className="table-wrap"><table>
              <thead><tr>{b.head.map((c, j) => <th key={j}><Inline text={c} onCite={onCite} /></th>)}</tr></thead>
              <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}><Inline text={c} onCite={onCite} /></td>)}</tr>)}</tbody>
            </table></div>
          );
        }
        return <p key={i}><Inline text={b.text} onCite={onCite} /></p>;
      })}
    </div>
  );
}
