import { layoutToLines } from './pdfLoader.js';

const isNumeric = (t) => /^[\d.,%$()\-–+]+$/.test(t) && /\d/.test(t);

function toMarkdown(rows, headerRows) {
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const header = rows.slice(0, headerRows).map(pad);
  const headerLine = header.length ? header.reduce((acc, r) => acc.map((c, i) => `${c} ${r[i]}`.trim()), Array(width).fill('')) : pad(rows[0]);
  const body = rows.slice(header.length || 1).map(pad);
  return [`| ${headerLine.join(' | ')} |`, `| ${headerLine.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/**
 * Detects grid-like regions from segment alignment. Rows stay rows, header rows are kept and the
 * nearest caption is attached so units survive. This is a heuristic: vision extraction covers
 * tables whose structure comes from lines or graphics rather than text positions.
 */
export class TableExtractor {
  name = 'table';

  async extractPage({ layout }) {
    const lines = layoutToLines(layout, { columns: false });
    const tables = [];
    let run = [];
    const close = () => {
      if (run.length >= 3) {
        const t = this.build(run, lines);
        if (t) tables.push(t);
      }
      run = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const cells = l.segments.length;
      const numericCells = l.segments.filter((s) => isNumeric(s.text)).length;
      const looksRow = cells >= 3 || (cells >= 2 && numericCells >= 1 && l.text.length < 140);
      if (looksRow) run.push(l);
      else if (run.length && cells === 1 && l.text.length < 70 && lines[i + 1]?.segments.length >= 2 && !isNumeric(l.text)) run.push(l);
      else close();
    }
    close();
    return { tables, method: 'table-heuristic' };
  }

  build(run, allLines) {
    const anchorRow = run.reduce((a, b) => (b.segments.length > a.segments.length ? b : a));
    const anchors = anchorRow.segments.map((s) => ({ x0: s.x0, x1: s.x1 }));
    const rows = run.map((l) => {
      const cells = Array(anchors.length).fill('');
      l.segments.forEach((s) => {
        const center = (s.x0 + s.x1) / 2;
        let best = 0;
        anchors.forEach((a, i) => {
          if (Math.abs((a.x0 + a.x1) / 2 - center) < Math.abs((anchors[best].x0 + anchors[best].x1) / 2 - center)) best = i;
        });
        cells[best] = `${cells[best]} ${s.text}`.trim();
      });
      return cells;
    });
    const dataStart = rows.findIndex((r) => r.slice(1).filter(isNumeric).length >= Math.max(1, (r.length - 1) / 2));
    const numericRows = rows.filter((r) => r.slice(1).some(isNumeric)).length;
    const labelled = rows.filter((r) => r[0] && !isNumeric(r[0]) && r.slice(1).some(isNumeric)).length;
    if (numericRows < 3 || labelled < numericRows * 0.6) return null;
    const headerRows = dataStart > 0 ? Math.min(dataStart, 3) : 1;
    const idx = allLines.indexOf(run[0]);
    const caption = allLines.slice(Math.max(0, idx - 2), idx).map((l) => l.text).join(' ').trim() || null;
    return { caption, headerRows, rows, markdown: toMarkdown(rows, headerRows) };
  }
}
