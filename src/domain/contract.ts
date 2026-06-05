import type { StepDef } from './workflow.js';

export interface ContextRef { id: string; version: number; type: string; title: string; one_line: string; path?: string; alt?: string; blob?: string; }
export interface NextAction { cmd: string; args: Record<string, unknown>; }
export interface Contract { allowed_action: string; do_not: string[]; when_done: string[]; next_actions: NextAction[]; }
interface Ids { workItem: string; run: string; session: string; }

export function buildContract(step: StepDef, requiredContext: ContextRef[], ids: Ids): Contract {
  const base = `apm step complete ${ids.run} ${step.id}`;
  switch (step.type) {
    case 'agent_prompt':
    case 'agent_execution': {
      const types = (step.outputs ?? []).map((o) => o.artifact_type);
      const primary = types[0];
      const action = step.type === 'agent_execution'
        ? `Execute the work for "${step.id}" and record ${types.join(', ') || 'a work_log'}.`
        : `Produce the ${types.join(', ') || step.id} artifact(s) for "${step.id}".`;
      const when_done = primary
        ? [`${base} --artifact-type ${primary} --body-file <path> --agent <agent>`]
        : [`${base} --agent <agent>`];
      const next_actions: NextAction[] = primary
        ? [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id, artifact_type: primary, body_file: '<path>' } }]
        : [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }];
      // extra outputs beyond the first must be created separately
      const extra = types.slice(1).map((t) => `apm artifact create --work-item ${ids.workItem} --type ${t} --title <t> --body-file <path> --agent <agent>`);
      return { allowed_action: action, do_not: doNotFor(step), when_done: [...extra, ...when_done], next_actions };
    }
    case 'review_gate': {
      const roles = step.reviewers ?? [];
      return {
        allowed_action: `Review "${step.id}" and submit a verdict for each role: ${roles.join(', ')}.`,
        do_not: ['advance the workflow manually'],
        when_done: roles.map((r) => `apm step review ${ids.run} ${step.id} --reviewer ${r} --verdict pass --agent <agent>`),
        next_actions: roles.map((r) => ({ cmd: 'apm step review', args: { run: ids.run, step: step.id, reviewer: r, verdict: 'pass' } })),
      };
    }
    case 'decision':
      return {
        allowed_action: `Record a decision for "${step.id}", then complete the step.`,
        do_not: doNotFor(step),
        when_done: [`apm decision create --work-item ${ids.workItem} --question <q> --options <csv> --recommendation <r> --confidence <n> --agent <agent>`, `${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
    case 'integration':
    case 'integration_loop':
      return {
        allowed_action: `Manual integration step "${step.id}" (${step.action ?? 'external action'}): perform it, then complete.`,
        do_not: [],
        when_done: [`${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
    default:
      return {
        allowed_action: `Complete step "${step.id}".`,
        do_not: [],
        when_done: [`${base} --agent <agent>`],
        next_actions: [{ cmd: 'apm step complete', args: { run: ids.run, step: step.id } }],
      };
  }
}

/**
 * Render a dispatched `next` payload into the agent-format prompt contract text.
 * Pure and shared by the `agent` formatter (presentation) and `next` (which stores
 * the result on the step run for reference + the viewer UI), so the stored text is
 * byte-identical to what `apm next --format agent` prints.
 */
export interface CaptureRef { name: string; kind: string; route?: string; viewport?: { w: number; h: number }; prompt?: string; }
export interface DispatchPayload {
  work_item: string;
  step: { id: string; type: string };
  prompt_id?: string | null;
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
  if (d.prompt_id != null) lines.push('', 'PROMPT:', d.prompt_id);
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

function doNotFor(step: StepDef): string[] {
  const dn: string[] = [];
  if (step.type === 'agent_prompt') { dn.push('write implementation code', 'open a PR'); }
  if (step.type === 'agent_execution') { dn.push('skip recording the work_log'); }
  return dn.slice(0, 3);
}
