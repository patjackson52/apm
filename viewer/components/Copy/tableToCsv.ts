import type { TableModel } from './tableToMarkdown';

const field = (v: string) =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/** Serialize a table model to RFC-4180 CSV (CRLF rows, quoted as needed). */
export function tableToCsv(t: TableModel): string {
  const rows = [t.headers, ...t.rows];
  return rows.map((r) => r.map(field).join(',')).join('\r\n');
}
