import { parse as parseYaml } from 'yaml';
import { ApmError } from './errors.js';
import { STEP_TYPES, type StepType, type ArtifactType, type WorkItemType } from './types.js';

export interface StepOutput { artifact_type: ArtifactType; }
export interface StepDef {
  id: string; type: StepType;
  prompt_id?: string;
  requires?: { artifacts?: ArtifactType[]; capabilities?: string[] };
  outputs?: StepOutput[];
  reviewers?: string[];
  pass_policy?: 'all_required';
  action?: string;
  may_create_work_items?: boolean;
  next?: string[];
}
export interface WorkflowDef {
  id: string; version: number; name: string;
  applies_to: WorkItemType[]; status: string;
  session_policy?: unknown;
  steps: StepDef[];
}

export function parseWorkflow(yaml: string): WorkflowDef {
  const raw = parseYaml(yaml);
  return raw as WorkflowDef;
}

export function validateWorkflow(def: WorkflowDef): void {
  if (!def.id || !def.steps?.length) throw new ApmError('E_VALIDATION', 'workflow needs id and steps');
  const ids = new Set(def.steps.map((s) => s.id));
  for (const s of def.steps) {
    if (!STEP_TYPES.includes(s.type)) throw new ApmError('E_VALIDATION', `unknown step type: ${s.type}`);
    if (s.next && s.next.length > 1) throw new ApmError('E_VALIDATION', `step ${s.id}: V1 is linear (single next target)`);
    for (const n of s.next ?? []) if (!ids.has(n)) throw new ApmError('E_VALIDATION', `step ${s.id}: next points at unknown step ${n}`);
    if (s.type === 'review_gate' && !(s.reviewers?.length)) throw new ApmError('E_VALIDATION', `review_gate ${s.id} needs reviewers`);
    if (s.type !== 'terminal' && !(s.next?.length)) throw new ApmError('E_VALIDATION', `non-terminal step ${s.id} needs a next`);
  }
}

export function firstStep(def: WorkflowDef): StepDef { return def.steps[0]; }
export function stepById(def: WorkflowDef, id: string): StepDef | undefined { return def.steps.find((s) => s.id === id); }
export function nextStepId(def: WorkflowDef, id: string): string | null {
  const s = stepById(def, id); return s?.next?.[0] ?? null;
}
