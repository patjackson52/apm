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

// ─── viewer layout helpers (pure; consumed by `workflow show` / apm serve) ──────

/** Sentence-case a step id for display: "design_review" → "Design review". */
export function titleCase(id: string): string {
  const words = id.split(/[_-]+/).filter(Boolean);
  if (words.length === 0) return id;
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(' ');
}

export interface StepLayout { x: number; y: number; label: string; }

/**
 * Lay out a (linear, V1) workflow as a single lane: walk `next[0]` from the first
 * step, assign x = index*colW, y = 0, label = titleCase(id). Any steps not on the
 * linear path are appended in declaration order (defensive). Pure + deterministic.
 */
export function layoutSteps(def: WorkflowDef, colW = 220): Array<StepDef & StepLayout> {
  const order: StepDef[] = [];
  const seen = new Set<string>();
  let cur: StepDef | undefined = firstStep(def);
  while (cur && !seen.has(cur.id)) {
    order.push(cur);
    seen.add(cur.id);
    const nextId: string | undefined = cur.next?.[0];
    cur = nextId ? stepById(def, nextId) : undefined;
  }
  for (const s of def.steps) if (!seen.has(s.id)) { order.push(s); seen.add(s.id); }
  return order.map((s, i) => ({ ...s, x: i * colW, y: 0, label: titleCase(s.id) }));
}

/** Directed edges derived from each step's `next[]`. */
export function edgesOf(def: WorkflowDef): Array<{ from: string; to: string }> {
  return def.steps.flatMap((s) => (s.next ?? []).map((to) => ({ from: s.id, to })));
}
