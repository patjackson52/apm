import type { StructuredDispatch } from '@apm/types';

/**
 * Render a StructuredDispatch as a Markdown document: each contract section as a
 * `## SECTION` heading, the stored prompt body fenced. Pure — no DOM, no sink.
 * Mirrors the layered ComposedPrompt view (WORK_ITEM / CURRENT_STEP / PROMPT /
 * ALLOWED_ACTION / REQUIRED_CONTEXT / DO_NOT / WHEN_DONE).
 */
export function composeMarkdown(d: StructuredDispatch): string {
  const s = d.scaffold;
  const out: string[] = [];

  out.push('## WORK_ITEM', '', d.step_id ? `${d.step_id}` : '(work item)', '');
  out.push('## CURRENT_STEP', '', `${d.step_id} (${d.step_type})`, '');

  const promptLabel =
    d.prompt_name != null
      ? `## PROMPT — ${d.prompt_name}@${d.prompt_version ?? '?'}`
      : '## PROMPT';
  out.push(promptLabel, '', '```', d.body ?? '', '```', '');

  if (s.allowed_action) {
    out.push('## ALLOWED_ACTION', '', s.allowed_action, '');
  }
  if (s.required_context.length > 0) {
    out.push('## REQUIRED_CONTEXT', '', ...s.required_context.map((c) => `- ${c}`), '');
  }
  if (s.do_not.length > 0) {
    out.push('## DO_NOT', '', ...s.do_not.map((x) => `- ${x}`), '');
  }
  if (s.when_done.length > 0) {
    out.push('## WHEN_DONE', '', ...s.when_done.map((x) => `- ${x}`), '');
  }

  return out.join('\n').replace(/\n+$/, '') + '\n';
}
