import type { StepRunView } from '@apm/types';

export interface ReviewerMark {
  role: string | null;
  verdict: 'pass' | 'reject' | 'abstain' | null;
  round: number;
}
export interface StepOverlay {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  reviewers: ReviewerMark[];
  stepRunId?: string;
  failureReason?: string | null;
  artifactId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  /** Agent-format dispatch contract last built by `apm next --acquire` for this step. */
  dispatchPrompt?: string | null;
}

// Latest-first by (review_round desc, started_at desc); null started_at sorts last.
function laterMain(a: StepRunView, b: StepRunView): StepRunView {
  if (a.review_round !== b.review_round) return a.review_round > b.review_round ? a : b;
  return (a.started_at ?? '') >= (b.started_at ?? '') ? a : b;
}

/** Map each step_id to its latest main step-run + review_gate reviewer fan-in. Pure. */
export function buildOverlay(stepRuns: StepRunView[]): Map<string, StepOverlay> {
  const mains = stepRuns.filter((r) => r.parent_step_run_id === null);
  const reviewers = stepRuns.filter((r) => r.parent_step_run_id !== null);

  const latestByStep = new Map<string, StepRunView>();
  for (const m of mains) {
    const prev = latestByStep.get(m.step_id);
    latestByStep.set(m.step_id, prev ? laterMain(prev, m) : m);
  }

  const out = new Map<string, StepOverlay>();
  for (const [stepId, main] of latestByStep) {
    const marks: ReviewerMark[] = reviewers
      .filter((r) => r.parent_step_run_id === main.id)
      .map((r) => ({ role: r.role, verdict: r.verdict, round: r.review_round }));
    out.set(stepId, {
      status: main.status,
      reviewers: marks,
      stepRunId: main.id,
      failureReason: main.failure_reason,
      artifactId: main.output_artifact_id,
      startedAt: main.started_at,
      completedAt: main.completed_at,
      dispatchPrompt: main.dispatch_prompt,
    });
  }
  return out;
}
