export const STEP_TYPES = [
  'agent_prompt', 'agent_execution', 'review_gate', 'human_gate', 'decision',
  'decompose', 'integration', 'integration_loop', 'manual', 'terminal',
] as const;
export type StepType = (typeof STEP_TYPES)[number];

export interface StepMeta { label: string }

export const STEP_META: Record<StepType, StepMeta> = {
  agent_prompt: { label: 'Agent Prompt' },
  agent_execution: { label: 'Agent Execution' },
  review_gate: { label: 'Review Gate' },
  human_gate: { label: 'Human Gate' },
  decision: { label: 'Decision' },
  decompose: { label: 'Decompose' },
  integration: { label: 'Integration' },
  integration_loop: { label: 'Integration Loop' },
  manual: { label: 'Manual' },
  terminal: { label: 'Terminal' },
};

const KNOWN = new Set<string>(STEP_TYPES);

/** Meta for any step type; unknown types get a neutral fallback (never throws). */
export function metaFor(type: string): StepMeta {
  return KNOWN.has(type) ? STEP_META[type as StepType] : { label: 'Step' };
}

/** A safe CSS-class key for tinting a node by type (no raw values; unknown -> 'unknown'). */
export function tintKey(type: string): string {
  return KNOWN.has(type) ? type : 'unknown';
}
