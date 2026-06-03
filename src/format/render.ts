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

function renderAgent(envelope: Envelope<any>): string {
  const d = envelope.data;
  if (!d) {
    // error envelope — fallback
    const withNote = { ...envelope, meta: { ...envelope.meta, note: 'agent format not applicable; emitted json' } };
    return JSON.stringify(withNote, null, 2);
  }

  // idle
  if (d.status === 'idle') {
    return `status=idle reason=${d.reason} retry_after=${d.retry_after}`;
  }

  // drained
  if (d.status === 'drained') {
    if (!d.reason && !d.counts) return 'status=drained';
    const c = d.counts ?? {};
    const countsStr = ['draft', 'ready', 'active', 'blocked', 'running_runs']
      .map((k) => `${k}:${c[k] ?? 0}`).join(',');
    return `status=drained reason=${d.reason ?? 'complete'} counts=${countsStr}`;
  }

  // dispatched next payload (has work_item + step)
  if (d.work_item && d.step) {
    const lines: string[] = [];

    lines.push('WORK_ITEM:');
    lines.push(d.work_item);

    lines.push('');
    lines.push('CURRENT_STEP:');
    lines.push(`${d.step.id} (${d.step.type})`);

    if (d.prompt_id != null) {
      lines.push('');
      lines.push('PROMPT:');
      lines.push(d.prompt_id);
    }

    lines.push('');
    lines.push('ALLOWED_ACTION:');
    lines.push(d.allowed_action ?? '');

    if (Array.isArray(d.required_context) && d.required_context.length > 0) {
      lines.push('');
      lines.push('REQUIRED_CONTEXT:');
      for (const ctx of d.required_context) {
        lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" — ${ctx.one_line}`);
      }
    }

    if (Array.isArray(d.do_not) && d.do_not.length > 0) {
      lines.push('');
      lines.push('DO_NOT:');
      for (const item of d.do_not) {
        lines.push(`- ${item}`);
      }
    }

    if (Array.isArray(d.when_done) && d.when_done.length > 0) {
      lines.push('');
      lines.push('WHEN_DONE:');
      for (const item of d.when_done) {
        lines.push(item);
      }
    }

    return lines.join('\n');
  }

  // non-next command — fallback to json with note
  const withNote = { ...envelope, meta: { ...envelope.meta, note: 'agent format not applicable; emitted json' } };
  return JSON.stringify(withNote, null, 2);
}

export function render(format: OutputFormat, envelope: Envelope<any>): string {
  if (format === 'human') return renderHuman(envelope);
  if (format === 'yaml') return toYaml(envelope);
  if (format === 'agent') return renderAgent(envelope);
  return JSON.stringify(envelope, null, 2);
}
