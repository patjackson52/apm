import type { StructuredDispatch } from '@apm/types';

export function makeDispatch(overrides: Partial<StructuredDispatch> = {}): StructuredDispatch {
  return {
    step_id: 'WR-7/implementation',
    step_type: 'agent_execution',
    status: 'running',
    prompt_name: 'implementation',
    prompt_version: 2,
    latest_version: 2,
    body: 'Implement the feature described in the spec. Keep the diff minimal.',
    scaffold: {
      allowed_action: 'Write code and tests for the feature.',
      required_context: ['ART-9 "My Spec" — the approved spec', 'WI-1 — parent feature'],
      do_not: ['Do not modify unrelated files', 'Do not commit'],
      when_done: ['apm step complete WR-7 implementation --agent claude'],
    },
    raw: 'WORK_ITEM:\nWI-1 — Feature\n\nCURRENT_STEP:\nWR-7/implementation (agent_execution)\n\nPROMPT: implementation@2\nImplement the feature.\nALLOWED_ACTION:\nWrite code and tests.',
    at: '2026-06-08T00:00:00Z',
    ...overrides,
  };
}
