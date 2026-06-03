import type { WorkflowDef } from '../domain/workflow.js';

export const FEATURE_DELIVERY: WorkflowDef = {
  id: 'feature_delivery', version: 1, name: 'Feature Delivery Workflow',
  applies_to: ['feature', 'task'], status: 'active',
  steps: [
    { id: 'brainstorm', type: 'agent_prompt', prompt_id: 'brainstorm_feature_v1', outputs: [{ artifact_type: 'decision' }, { artifact_type: 'spec' }], next: ['design'] },
    { id: 'design', type: 'agent_prompt', prompt_id: 'design_solution_v1', requires: { artifacts: ['spec'] }, outputs: [{ artifact_type: 'design' }], next: ['design_review'] },
    { id: 'design_review', type: 'review_gate', reviewers: ['architecture', 'security', 'simplicity'], pass_policy: 'all_required', on_reject: 'design', next: ['planning'] },
    { id: 'planning', type: 'agent_prompt', prompt_id: 'implementation_plan_v1', requires: { artifacts: ['design'] }, outputs: [{ artifact_type: 'plan' }], may_create_work_items: true, next: ['implementation'] },
    { id: 'implementation', type: 'agent_execution', requires: { artifacts: ['plan'] }, outputs: [{ artifact_type: 'work_log' }], next: ['pr_create'] },
    { id: 'pr_create', type: 'integration', action: 'github_create_pr', next: ['pr_monitor'] },
    { id: 'pr_monitor', type: 'integration_loop', action: 'github_monitor_pr', next: ['merge'] },
    { id: 'merge', type: 'integration', action: 'github_merge_pr', next: ['complete'] },
    { id: 'complete', type: 'terminal' },
  ],
};

export const DEFAULT_POLICY = {
  auto_accept_recommendations: { enabled: true, confidence_threshold: 90 },
  auto_create_work_items: true,
  adr_policy: { auto_create: true, categories: ['architecture', 'storage', 'platform', 'workflow'], confidence_threshold: 85 },
  max_work_item_depth: 5,
  // rec #4: when a work item completes, auto-activate dependents whose deps are all done.
  // OFF by default — opt in at global or milestone-subtree scope to let the loop self-advance.
  auto_activate_dependents: false,
};
