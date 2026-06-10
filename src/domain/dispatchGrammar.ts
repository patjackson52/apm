/**
 * The single render+parse implementation of the agent-format dispatch contract.
 * Render is shared by the `agent` formatter and `next` (which snapshots the result
 * on the step run); parse turns a stored snapshot back into its sections + the stored
 * prompt body region so the viewer can render the layered view without re-deriving.
 */
export interface ContextRef { id: string; version: number; type: string; title: string; one_line: string; path?: string; alt?: string; blob?: string; }
export interface CaptureRef { name: string; kind: string; route?: string; viewport?: { w: number; h: number }; prompt?: string; }

export interface DispatchPayload {
  work_item: string;
  step: { id: string; type: string };
  /** Stored prompt resolved at dispatch — inlined under `PROMPT (name@version):`. */
  prompt_name?: string | null;
  prompt_version?: number | null;
  prompt_body?: string | null;
  allowed_action?: string;
  required_context?: ContextRef[];
  required_captures?: CaptureRef[];
  do_not?: string[];
  when_done?: string[];
}

export function renderDispatchPrompt(d: DispatchPayload): string {
  const lines: string[] = [];
  lines.push('WORK_ITEM:', d.work_item);
  lines.push('', 'CURRENT_STEP:', `${d.step.id} (${d.step.type})`);
  if (d.prompt_name != null) {
    const tag = d.prompt_version != null ? `${d.prompt_name}@${d.prompt_version}` : d.prompt_name;
    lines.push('', `PROMPT (${tag}):`);
    lines.push(d.prompt_body ?? '');
  }
  lines.push('', 'ALLOWED_ACTION:', d.allowed_action ?? '');
  if (Array.isArray(d.required_context) && d.required_context.length > 0) {
    lines.push('', 'REQUIRED_CONTEXT:');
    for (const ctx of d.required_context) {
      if (ctx.path) {
        lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" [image]`);
        lines.push(`  path: ${ctx.path}`);
        if (ctx.alt) lines.push(`  alt:  ${ctx.alt}`);
      } else {
        lines.push(`${ctx.id}@${ctx.version} "${ctx.title}" — ${ctx.one_line}`);
      }
    }
  }
  if (Array.isArray(d.required_captures) && d.required_captures.length > 0) {
    lines.push('', 'REQUIRED_CAPTURES:');
    for (const c of d.required_captures) {
      const parts = [c.name, `kind=${c.kind}`];
      if (c.route) parts.push(`route=${c.route}`);
      if (c.viewport) parts.push(`viewport=${c.viewport.w}x${c.viewport.h}`);
      if (c.prompt) parts.push(`recipe=${c.prompt}`);
      lines.push(parts.join('  '));
    }
  }
  if (Array.isArray(d.do_not) && d.do_not.length > 0) {
    lines.push('', 'DO_NOT:');
    for (const item of d.do_not) lines.push(`- ${item}`);
  }
  if (Array.isArray(d.when_done) && d.when_done.length > 0) {
    lines.push('', 'WHEN_DONE:');
    for (const item of d.when_done) lines.push(item);
  }
  return lines.join('\n');
}

export interface ParsedDispatch {
  work_item: string | null;
  current_step: string | null;
  prompt: { name: string; version: number | null; body: string } | null;
  allowed_action: string | null;
  required_context: string[];
  do_not: string[];
  when_done: string[];
}

const HEADERS = ['WORK_ITEM:', 'CURRENT_STEP:', 'ALLOWED_ACTION:', 'REQUIRED_CONTEXT:', 'REQUIRED_CAPTURES:', 'DO_NOT:', 'WHEN_DONE:'];
const isHeader = (line: string): boolean => HEADERS.includes(line.trim()) || /^PROMPT \(.+\):$/.test(line.trim());

/** Split a rendered contract into sections; the PROMPT header carries name@version and
 *  its body is every line until the next header. Deterministic — same grammar as render. */
export function parseDispatchPrompt(text: string): ParsedDispatch {
  const out: ParsedDispatch = {
    work_item: null, current_step: null, prompt: null, allowed_action: null,
    required_context: [], do_not: [], when_done: [],
  };
  const buf: Record<string, string[]> = {};
  let section: string | null = null;
  let promptHeader: string | null = null;
  for (const line of text.split('\n')) {
    if (isHeader(line)) {
      section = line.trim();
      buf[section] = [];
      if (section.startsWith('PROMPT (')) promptHeader = section;
      continue;
    }
    if (section) (buf[section] ??= []).push(line);
  }
  const firstNonEmpty = (k: string): string | null => buf[k]?.find((l) => l.trim() !== '') ?? null;
  out.work_item = firstNonEmpty('WORK_ITEM:');
  out.current_step = firstNonEmpty('CURRENT_STEP:');
  out.allowed_action = firstNonEmpty('ALLOWED_ACTION:');
  out.required_context = (buf['REQUIRED_CONTEXT:'] ?? []).filter((l) => l.trim() !== '');
  out.do_not = (buf['DO_NOT:'] ?? []).filter((l) => l.trim() !== '').map((l) => l.replace(/^- /, ''));
  out.when_done = (buf['WHEN_DONE:'] ?? []).filter((l) => l.trim() !== '');
  if (promptHeader) {
    const m = promptHeader.match(/^PROMPT \((.+?)(?:@(\d+))?\):$/);
    const body = (buf[promptHeader] ?? []).join('\n').replace(/^\n+|\n+$/g, '');
    if (m) out.prompt = { name: m[1]!, version: m[2] ? parseInt(m[2], 10) : null, body };
  }
  return out;
}
