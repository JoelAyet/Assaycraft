/**
 * Delimited text (TSV from Excel / Google Sheets clipboard, CSV files).
 * Quoting follows Excel: fields with the delimiter, quotes or newlines are wrapped in "…" with "" escapes.
 */

export function parseDelimited(text: string, delimiter = '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Excel adds a trailing newline: drop a final empty row
  while (rows.length > 1 && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => (r.length < width ? [...r, ...Array.from({ length: width - r.length }, () => '')] : r));
}

function quote(field: string, delimiter: string): string {
  if (field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r')) {
    return '"' + field.replace(/"/g, '""') + '"';
  }
  return field;
}

export function toDelimited(rows: string[][], delimiter = '\t'): string {
  return rows.map((r) => r.map((f) => quote(f, delimiter)).join(delimiter)).join(delimiter === '\t' ? '\n' : '\r\n');
}

/** Guess the delimiter of a CSV-like file (comma, semicolon or tab). */
export function sniffDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const counts = [',', ';', '\t'].map((d) => ({ d, n: sample.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}
