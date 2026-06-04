/**
 * The advance engine — enforces the run invariant:
 * every active run is (a) terminal, OR (b) has exactly one pending main-path step
 * (parent_step_run_id IS NULL), OR (c) has an open blocker on its work item.
 *
 * All transitions go through enterStep / completeMainStep here.
 */
import type { Tx } from '../storage/storage.js';
import { repos } from '../storage/repos.js';
import { ApmError } from './errors.js';
import { nextStepId, stepById, type WorkflowDef, type StepDef } from './workflow.js';
import { effectivePolicy } from './policy.js';

/**
 * Reopen a reviewer child step_run for a given role on a review_gate main step.
 * Increments the review_round. Used by blocker.resolve when blocker_type='review_disagreement'.
 */
export function reopenReviewer(tx: Tx, mainStepRunId: string, role: string): string {
  const r = repos(tx);
  const mainStep = r.stepRuns.byId(mainStepRunId);
  if (!mainStep) throw new ApmError('E_NOT_FOUND', `step_run ${mainStepRunId} not found`);

  // Find the highest review_round for this role to determine the new round
  const existing = tx.all<{ review_round: number }>(
    'SELECT review_round FROM workflow_step_runs WHERE parent_step_run_id=? AND role=? ORDER BY review_round DESC LIMIT 1',
    mainStepRunId, role,
  );
  const lastRound = existing[0]?.review_round ?? 0;
  const newRound = lastRound + 1;

  const id = r.stepRuns.insertPending(mainStep.workflow_run_id, mainStep.step_id, mainStepRunId, role, newRound);
  tx.appendEvent({
    eventType: 'workflow_run.reviewer_reopened', entityType: 'workflow_step_run',
    entityId: id, payload: { mainStepRunId, role, round: newRound },
  });
  return id;
}

/**
 * Enter the given step for the run. Creates the pending main step_run and performs
 * type-specific side effects. For terminal: completes the run + work item instead.
 */
export function enterStep(
  tx: Tx,
  runId: string,
  def: WorkflowDef,
  stepDef: StepDef,
  actor: string,
): void {
  const r = repos(tx);
  const run = r.runs.byId(runId);
  if (!run) throw new ApmError('E_NOT_FOUND', `run ${runId} not found`);

  if (stepDef.type === 'terminal') {
    // Complete the run + work item (child guard: no non-terminal child work items)
    const openChildren = tx.get<{ c: number }>(
      "SELECT count(*) c FROM work_items WHERE parent_id=? AND status NOT IN ('completed','cancelled')",
      run.work_item_id,
    );
    if ((openChildren?.c ?? 0) > 0) {
      throw new ApmError('E_PRECONDITION', 'cannot complete: work item has incomplete children');
    }
    if (!r.links.allDepsSatisfied(run.work_item_id)) {
      throw new ApmError('E_PRECONDITION', 'cannot complete: dependencies incomplete');
    }
    r.runs.setStatus(runId, 'completed', tx.now());
    r.workItems.setStatus(run.work_item_id, 'completed', actor, tx.now());
    tx.appendEvent({
      actorId: actor, eventType: 'workflow_run.completed', entityType: 'workflow_run',
      entityId: runId, payload: { stepId: stepDef.id },
    });
    return;
  }

  if (stepDef.type === 'human_gate') {
    // Create main step_run as 'running', then create an open blocker
    const stepRunId = r.stepRuns.insertPending(runId, stepDef.id, null, null, 1);
    r.stepRuns.setStatus(stepRunId, 'running');
    r.runs.setCurrentStep(runId, stepDef.id);
    r.blockers.insert({
      workItemId: run.work_item_id,
      type: 'human_gate',
      reason: `Human gate: ${stepDef.id}`,
      question: (stepDef as any).question ?? `Please answer: ${stepDef.id}`,
      optionsJson: (stepDef as any).options
        ? JSON.stringify((stepDef as any).options)
        : JSON.stringify(['yes', 'no']),
    });
    r.workItems.setStatus(run.work_item_id, 'blocked', actor);
    tx.appendEvent({
      actorId: actor, eventType: 'workflow_run.step_entered', entityType: 'workflow_run',
      entityId: runId, payload: { stepId: stepDef.id, type: stepDef.type },
    });
    return;
  }

  // All other step types: create the pending main step_run
  const stepRunId = r.stepRuns.insertPending(runId, stepDef.id, null, null, 1);
  r.runs.setCurrentStep(runId, stepDef.id);

  if (stepDef.type === 'review_gate') {
    // Seed one pending reviewer child per role
    for (const role of stepDef.reviewers ?? []) {
      r.stepRuns.insertPending(runId, stepDef.id, stepRunId, role, 1);
    }
  }

  tx.appendEvent({
    actorId: actor, eventType: 'workflow_run.step_entered', entityType: 'workflow_run',
    entityId: runId, payload: { stepId: stepDef.id, type: stepDef.type },
  });
}

/**
 * Auto-accept a decision: mark it decided with the recommendation as the choice,
 * optionally create an ADR artifact if adr_policy matches.
 * Returns the artifact id if an ADR was created, null otherwise.
 */
export function autoAcceptDecision(
  tx: Tx,
  decRow: any,
  actor: string,
): string | null {
  const r = repos(tx);
  const choice = decRow.recommendation ?? decRow.decision;
  if (!choice) throw new ApmError('E_PRECONDITION', 'decision has no recommendation to auto-accept');

  let artifactId: string | null = null;

  // Policy check for auto-create ADR (mirrors decision.accept logic)
  if (decRow.work_item_id) {
    const policy = effectivePolicy(tx, decRow.work_item_id);
    const adrPolicy = (policy as any).adr_policy;
    if (adrPolicy?.auto_create) {
      const categories: string[] = adrPolicy.categories ?? [];
      const threshold: number = adrPolicy.confidence_threshold ?? 100;
      const confidence: number = decRow.confidence ?? 0;
      if (decRow.category && categories.includes(decRow.category) && confidence >= threshold) {
        const adrBody = `# Decision\n\n**Question:** ${decRow.question}\n\n**Decision:** ${choice}\n\n**Category:** ${decRow.category}\n\n**Confidence:** ${confidence}%`;
        const artId = r.artifacts.insert({
          type: 'adr',
          title: decRow.question,
          body: adrBody,
          createdBy: actor,
          version: 1,
        });
        r.artifacts.linkToWorkItem(decRow.work_item_id, artId, 'decision');
        artifactId = artId;
        tx.appendEvent({
          actorId: actor, eventType: 'adr.auto_created', entityType: 'artifact',
          entityId: artId, payload: { decisionId: decRow.id },
        });
      }
    }
  }

  r.decisions.setDecided(decRow.id, choice, artifactId);
  return artifactId;
}

/**
 * Complete the main (non-child) step_run for a run.
 * Enforces required output artifacts, then advances to the next step.
 */
export function completeMainStep(
  tx: Tx,
  def: WorkflowDef,
  runRow: any,
  stepRunRow: any,
  opts: { artifactId?: string | null },
  actor: string,
): void {
  const r = repos(tx);

  // 1. Idempotent: if already completed, return
  if (stepRunRow.status === 'completed') return;

  // 2. Required output check for agent_prompt / agent_execution
  const stepDef = stepById(def, stepRunRow.step_id);
  if (!stepDef) throw new ApmError('E_INTERNAL', `step ${stepRunRow.step_id} not found in def`);

  if (stepDef.type === 'agent_prompt' || stepDef.type === 'agent_execution') {
    for (const out of stepDef.outputs ?? []) {
      const art = r.artifacts.currentByTypeForWorkItem(runRow.work_item_id, out.artifact_type);
      if (!art) {
        throw new ApmError('E_PRECONDITION', `missing required output: ${out.artifact_type}`);
      }
    }
  }

  // 3. Decision step: evaluate decision + policy before marking completed
  if (stepDef.type === 'decision') {
    // Find a Decision record linked to this work item in a decidable state
    const decRow = tx.get<any>(
      "SELECT * FROM decisions WHERE work_item_id=? AND status IN ('recommended','decided','open') ORDER BY id DESC LIMIT 1",
      runRow.work_item_id,
    );
    if (!decRow) {
      throw new ApmError('E_PRECONDITION', `no decision record found for work item ${runRow.work_item_id}`);
    }

    if (decRow.status === 'decided') {
      // Already decided — just advance
    } else {
      // Evaluate effectivePolicy
      const policy = effectivePolicy(tx, runRow.work_item_id);
      const autoAcceptPolicy = (policy as any).auto_accept_recommendations;
      const threshold: number = autoAcceptPolicy?.confidence_threshold ?? 100;
      const confidence: number = decRow.confidence ?? null;

      const shouldAutoAccept = confidence !== null && confidence >= threshold;

      if (shouldAutoAccept) {
        // Auto-accept: mark decided, optionally create ADR
        autoAcceptDecision(tx, decRow, actor);
      } else {
        // Below threshold / undecided → create human_gate blocker, do NOT advance
        r.blockers.insert({
          workItemId: runRow.work_item_id,
          type: 'human_gate',
          reason: `Decision required: ${decRow.question}`,
          question: decRow.question,
          optionsJson: decRow.options_json ?? JSON.stringify([]),
        });
        r.workItems.setStatus(runRow.work_item_id, 'blocked', actor);
        // Mark step_run as running (waiting for gate answer)
        r.stepRuns.setStatus(stepRunRow.id, 'running');
        r.runs.setCurrentStep(runRow.id, stepDef.id);
        tx.appendEvent({
          actorId: actor, eventType: 'workflow_run.step_blocked_on_decision', entityType: 'workflow_run',
          entityId: runRow.id, payload: { stepId: stepRunRow.step_id, decisionId: decRow.id },
        });
        return; // Do NOT advance
      }
    }
  }

  // 4. Mark step_run completed
  r.stepRuns.complete(stepRunRow.id, { artifactId: opts.artifactId ?? null });
  tx.appendEvent({
    actorId: actor, eventType: 'workflow_run.step_completed', entityType: 'workflow_run',
    entityId: runRow.id, payload: { stepId: stepRunRow.step_id },
  });

  // 5. Advance: determine next step
  const nextId = nextStepId(def, stepRunRow.step_id);
  if (nextId === null) {
    // Non-terminal with no next — validator should prevent this, but guard anyway
    throw new ApmError('E_PRECONDITION', `step ${stepRunRow.step_id} has no next step and is not terminal`);
  }

  const nextDef = stepById(def, nextId);
  if (!nextDef) throw new ApmError('E_INTERNAL', `next step ${nextId} not found in def`);

  // enterStep handles terminal (completes run) and all other types
  enterStep(tx, runRow.id, def, nextDef, actor);
}
