/**
 * Built-in prompt definitions referenced by the feature_delivery workflow's
 * `agent_prompt` steps (see ./feature_delivery.ts). Each `prompt_id` on a step
 * MUST resolve to one of these by name, or `apm prompt show <name>` returns
 * E_NOT_FOUND and the dispatch contract points at a phantom. seedBuiltins()
 * inserts these idempotently on `apm init`; workflow.register() validates that
 * every referenced prompt_id exists before accepting a definition.
 *
 * Bodies are durable per-step instructions, grounded in the step-type playbook.
 * They are immutable-once-used like any prompt; revise via `apm prompt create`
 * (a new version) rather than editing history.
 */
export interface BuiltinPrompt {
  name: string;
  body: string;
}

export const BUILTIN_PROMPTS: BuiltinPrompt[] = [
  {
    name: 'brainstorm_feature_v1',
    body: [
      '# Brainstorm',
      '',
      'Turn this feature into a concrete decision and a spec. Do NOT write implementation code.',
      '',
      '## Produce two artifacts',
      '',
      '1. **decision** — the central design choice for this feature: the question,',
      '   2-4 viable options with trade-offs, your recommendation, and a confidence',
      '   (0-100). If the design is already settled upstream, confidence is high.',
      '2. **spec** — the detailed, reviewable specification grounded in the work-item',
      '   description and any referenced context. Cover: purpose, scope (and explicit',
      '   non-goals), interfaces/contracts, data flow, error handling, and acceptance',
      '   criteria. Scale each section to its complexity; no placeholders or TBDs.',
      '',
      'Record both as markdown bodies via --body-file before completing the step.',
    ].join('\n'),
  },
  {
    name: 'design_solution_v1',
    body: [
      '# Design',
      '',
      'Produce a **design** artifact: the architecture and approach for this feature,',
      'grounded in the approved spec (provided as REQUIRED_CONTEXT). Do NOT write',
      'implementation code.',
      '',
      '## Cover',
      '',
      '- Component boundaries: what each unit does, its interface, and its dependencies.',
      '- Data flow and state ownership across the units.',
      '- Cited contracts: the apm-core/serve API surface or UI component boundaries the',
      '  design depends on.',
      '- Error handling and edge cases.',
      '- Testing strategy (what is unit-tested vs integration/e2e).',
      '- Security: if the feature touches markdown/mermaid/files/serve, state how the',
      '  relevant checklist items are satisfied.',
      '',
      'Design for isolation: small, well-bounded units with clear interfaces.',
    ].join('\n'),
  },
  {
    name: 'implementation_plan_v1',
    body: [
      '# Implementation Plan',
      '',
      'Produce a **plan** artifact: bite-sized, test-driven tasks that implement the',
      'approved design (provided as REQUIRED_CONTEXT). Do NOT write implementation code.',
      '',
      '## Each task',
      '',
      '- Names exact files to create/modify/test.',
      '- Is one small, self-contained change with the failing test shown first, then the',
      '  minimal implementation, then the command to run and its expected output, then a',
      '  commit. No placeholders — show the actual code/tests an engineer would write.',
      '- Keeps types, signatures, and names consistent across tasks.',
      '',
      'This step may create small child work items. After self-review (spec coverage,',
      'placeholder scan, type consistency), record the plan via --body-file.',
    ].join('\n'),
  },
];

/** Names of the seeded built-in prompts — used to badge prompts as built-in vs custom. */
export const BUILTIN_PROMPT_NAMES = new Set(BUILTIN_PROMPTS.map((p) => p.name));
