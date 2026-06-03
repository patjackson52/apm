export interface TableModel {
  headers: string[];
  rows: string[][];
}

const cell = (v: string) => v.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** Serialize a table model to a GitHub-flavored markdown table. */
export function tableToMarkdown(t: TableModel): string {
  const head = `| ${t.headers.map(cell).join(' | ')} |`;
  const sep = `| ${t.headers.map(() => '---').join(' | ')} |`;
  const body = t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}
