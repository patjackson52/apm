import { stringify as toYaml } from 'yaml';
import type { Envelope } from './envelope.js';

export type OutputFormat = 'human' | 'json' | 'yaml' | 'agent';

function isPage(data: any): boolean {
  return data && typeof data === 'object' && Array.isArray(data.items) && data.page;
}

function kv(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const width = Math.max(...keys.map((k) => k.length));
  return keys.map((k) => {
    const v = obj[k];
    const val = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(typeof v === 'object' ? JSON.stringify(v) : v);
    return `${k.padEnd(width)}  ${val}`;
  }).join('\n');
}

function table(items: Record<string, unknown>[]): string {
  if (items.length === 0) return '(none)';
  const cols = Object.keys(items[0]).filter((c) => typeof items[0][c] !== 'object' || items[0][c] === null);
  const widths = cols.map((c) => Math.max(c.length, ...items.map((i) => String(i[c] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  return [line(cols), ...items.map((it) => line(cols.map((c) => String(it[c] ?? ''))))].join('\n');
}

function renderHuman(env: Envelope<any>): string {
  if (!env.ok && env.error) {
    let s = `error: ${env.error.code} ${env.error.message}`;
    if (env.error.issues) s += '\n' + env.error.issues.map((i) => `  - ${i.field}: ${i.problem}`).join('\n');
    return s;
  }
  const d = env.data;
  if (isPage(d)) {
    const tbl = table(d.items);
    return d.page.has_more ? `${tbl}\n(${d.items.length} of ${d.page.total}; --offset ${d.page.offset + d.page.limit} for more)` : tbl;
  }
  if (d && typeof d === 'object') return kv(d);
  return String(d);
}

export function render(format: OutputFormat, envelope: Envelope<any>): string {
  if (format === 'human') return renderHuman(envelope);
  if (format === 'yaml') return toYaml(envelope);
  if (format === 'agent') {
    // Plan 2 commands have no agent projection; fall back to json with a note.
    const withNote = { ...envelope, meta: { ...envelope.meta, note: 'agent format not applicable; emitted json' } };
    return JSON.stringify(withNote, null, 2);
  }
  return JSON.stringify(envelope, null, 2);
}
