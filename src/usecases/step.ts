import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { validateWorkflow, type WorkflowDef, stepById } from '../domain/workflow.js';
import { completeMainStep } from '../domain/advance.js';
import { cascadeActivateDependents } from './workflow.js';
import { toRunView, toStepRunView, type RunView, type StepRunView } from '../domain/entities.js';
import { REVIEW_VERDICTS, type ReviewVerdict } from '../domain/types.js';
import { addImageTx } from './image.js';
import type { BlobMeta } from '../storage/blobstore.js';

/** review_gate self-heal: max times the on_reject (source) step is re-opened before falling back to a human block. */
const MAX_REVISE_ROUNDS = 3;

export interface CompleteArgs {
  run: string;
  step: string;
  agent: string;
  artifactId?: string | null;
  artifactType?: string | null;
  bodyFile?: string | null;
  imageBlob?: BlobMeta | null;
  imageKind?: string | null;
  imageAlt?: string | null;
}

export function complete(ctx: Ctx, a: CompleteArgs): RunView {
  const result = ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const runRow = r.runs.byId(a.run);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${a.run} not found`);

    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');

    const def: WorkflowDef = JSON.parse(defRow.definition_json);
    validateWorkflow(def);

    // CAS: the named step must be the current pending main step
    const mainStep = r.stepRuns.mainPending(a.run);
    if (!mainStep || mainStep.step_id !== a.step) {
      throw new ApmError(
        'E_CONFLICT',
        `step ${a.step} is not the current pending main step (current: ${mainStep?.step_id ?? 'none'})`,
      );
    }

    // If artifactType + body given, create the artifact first (inside the same txn)
    let resolvedArtifactId = a.artifactId ?? null;
    if (a.artifactType && a.bodyFile) {
      // bodyFile is the body content for now (Task 7 handles actual file reads)
      const artId = r.artifacts.insert({
        type: a.artifactType as any,
        title: a.artifactType,
        body: a.bodyFile,
        createdBy: a.agent,
        version: 1,
      });
      r.artifacts.linkToWorkItem(runRow.work_item_id, artId, 'produced');
      resolvedArtifactId = artId;
    }

    // Evidence screenshot: ingest the image, link it as evidence, wrap it in an output doc.
    if (a.imageBlob) {
      const img = addImageTx(tx, {
        workItem: runRow.work_item_id,
        kind: a.imageKind ?? 'screenshot',
        alt: a.imageAlt ?? undefined,
        relation: 'evidence',
        agent: a.agent,
        blob: a.imageBlob,
      });
      const evidenceId = r.artifacts.insert({
        type: 'review',
        title: `${a.step} evidence`,
        body: `![${img.alt ?? img.id}](apm:${img.id})`,
        createdBy: a.agent,
        version: 1,
      });
      r.artifacts.linkToWorkItem(runRow.work_item_id, evidenceId, 'produced');
      resolvedArtifactId = evidenceId;
    }

    completeMainStep(tx, def, runRow, mainStep, { artifactId: resolvedArtifactId }, a.agent);

    const updatedRun = r.runs.byId(a.run)!;
    return { view: toRunView(updatedRun, defRow.name), workItemId: runRow.work_item_id, runCompleted: updatedRun.status === 'completed' };
  });

  // Post-commit: if this step completed the run (terminal) → its work item is now completed.
  // Auto-activate dependents if policy allows (rec #4; no-op when flag is off). Own transactions.
  if (result.runCompleted) cascadeActivateDependents(ctx, result.workItemId, a.agent);
  return result.view;
}

export interface FailArgs {
  run: string;
  step: string;
  reason: string;
  agent: string;
}

export function fail(ctx: Ctx, a: FailArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const runRow = r.runs.byId(a.run);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${a.run} not found`);

    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');

    // CAS: the named step must be the current pending/running main step
    const mainStep = r.stepRuns.mainPending(a.run);
    if (!mainStep || mainStep.step_id !== a.step) {
      throw new ApmError(
        'E_CONFLICT',
        `step ${a.step} is not the current pending main step (current: ${mainStep?.step_id ?? 'none'})`,
      );
    }

    // Mark step_run failed
    r.stepRuns.fail(mainStep.id, a.reason);

    // Insert a step_failure blocker + set work item blocked
    r.blockers.insert({
      workItemId: runRow.work_item_id,
      type: 'step_failure',
      reason: a.reason,
    });
    r.workItems.setStatus(runRow.work_item_id, 'blocked', a.agent);

    tx.appendEvent({
      actorId: a.agent, eventType: 'workflow_run.step_failed', entityType: 'workflow_run',
      entityId: a.run, payload: { stepId: a.step, reason: a.reason },
    });

    const defName = defRow.name;
    return toRunView(r.runs.byId(a.run)!, defName);
  });
}

export interface RetryArgs {
  run: string;
  step: string;
  agent: string;
}

export function retry(ctx: Ctx, a: RetryArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const runRow = r.runs.byId(a.run);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${a.run} not found`);

    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');

    // Precondition: open step_failure blocker exists for the work item
    const openBlockers = r.blockers.listOpen({ workItemId: runRow.work_item_id, type: 'step_failure' });
    if (openBlockers.length === 0) {
      throw new ApmError('E_PRECONDITION', `no open step_failure blocker found for work item ${runRow.work_item_id}`);
    }

    // Resolve the step_failure blocker(s)
    for (const blocker of openBlockers) {
      r.blockers.resolve(blocker.id, { resolution: 'retried', answeredBy: a.agent });
    }

    // Find the failed step_run for this step to determine the round
    const failedStep = tx.get<{ review_round: number }>(
      "SELECT review_round FROM workflow_step_runs WHERE workflow_run_id=? AND step_id=? AND status='failed' ORDER BY id DESC LIMIT 1",
      a.run, a.step,
    );
    const newRound = (failedStep?.review_round ?? 0) + 1;

    // Create fresh pending main step_run (new attempt)
    const newStepRunId = r.stepRuns.insertPending(a.run, a.step, null, null, newRound);
    r.runs.setCurrentStep(a.run, a.step);

    // Set work item back to ready (unblocked) only if no other open blockers remain
    const remainingBlockers = r.blockers.listOpen({ workItemId: runRow.work_item_id });
    if (remainingBlockers.length === 0) {
      r.workItems.setStatus(runRow.work_item_id, 'ready', a.agent);
    }

    tx.appendEvent({
      actorId: a.agent, eventType: 'workflow_run.step_retried', entityType: 'workflow_run',
      entityId: a.run, payload: { stepId: a.step, newStepRunId, round: newRound },
    });

    return toRunView(r.runs.byId(a.run)!, defRow.name);
  });
}

export interface ReviseArgs { run: string; step: string; agent: string; }

/** Manually re-open a rejected review_gate's source step for revision (the manual counterpart
 *  to on_reject self-heal). Resolves any open review_disagreement blocker, fails the pending
 *  gate step, and re-opens the gate's on_reject step so `next` dispatches a revise. */
export function revise(ctx: Ctx, a: ReviseArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const runRow = r.runs.byId(a.run);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${a.run} not found`);
    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');
    const def: WorkflowDef = JSON.parse(defRow.definition_json);
    const stepDef = stepById(def, a.step);
    if (!stepDef || stepDef.type !== 'review_gate') {
      throw new ApmError('E_VALIDATION', `step ${a.step} is not a review_gate`);
    }
    if (!stepDef.on_reject) {
      throw new ApmError('E_PRECONDITION', `review_gate ${a.step} has no on_reject target to revise`);
    }

    // Resolve any open review_disagreement blocker(s) for this work item.
    for (const b of r.blockers.listOpen({ workItemId: runRow.work_item_id, type: 'review_disagreement' })) {
      r.blockers.resolve(b.id, { resolution: 'revising', answeredBy: a.agent });
    }
    // Fail the pending gate main step (so mainPending returns the re-opened source step).
    const gateMain = r.stepRuns.mainPending(a.run);
    if (gateMain && gateMain.step_id === a.step) r.stepRuns.fail(gateMain.id, 'reopened for revision');
    // Re-open the on_reject (source) step.
    const reviseCount = tx.get<{ c: number }>(
      "SELECT COUNT(*) c FROM workflow_step_runs WHERE workflow_run_id=? AND step_id=? AND parent_step_run_id IS NULL",
      a.run, stepDef.on_reject,
    )?.c ?? 0;
    r.stepRuns.insertPending(a.run, stepDef.on_reject, null, null, reviseCount + 1);
    r.runs.setCurrentStep(a.run, stepDef.on_reject);
    if (r.blockers.listOpen({ workItemId: runRow.work_item_id }).length === 0) {
      r.workItems.setStatus(runRow.work_item_id, 'ready', a.agent);
    }
    tx.appendEvent({
      actorId: a.agent, eventType: 'workflow_run.revise', entityType: 'workflow_run',
      entityId: a.run, payload: { stepId: a.step, reopened: stepDef.on_reject, round: reviseCount + 1 },
    });
    return toRunView(r.runs.byId(a.run)!, defRow.name);
  });
}

export interface ReviewArgs {
  run: string;
  step: string;
  reviewer: string;
  verdict: ReviewVerdict;
  artifactId?: string | null;
  agent: string;
}

export function review(ctx: Ctx, a: ReviewArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    if (!REVIEW_VERDICTS.includes(a.verdict)) {
      throw new ApmError('E_VALIDATION', `invalid verdict: must be one of ${REVIEW_VERDICTS.join('|')}`);
    }

    const runRow = r.runs.byId(a.run);
    if (!runRow) throw new ApmError('E_NOT_FOUND', `run ${a.run} not found`);

    const defRow = r.defs.byId(runRow.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');

    const def: WorkflowDef = JSON.parse(defRow.definition_json);
    validateWorkflow(def);

    const stepDef = stepById(def, a.step);
    if (!stepDef) throw new ApmError('E_NOT_FOUND', `step ${a.step} not found in workflow`);

    // Validate reviewer role is one of the step's reviewers
    if (!stepDef.reviewers?.includes(a.reviewer)) {
      throw new ApmError(
        'E_VALIDATION',
        `reviewer role '${a.reviewer}' is not valid for step '${a.step}'. Valid roles: ${stepDef.reviewers?.join(', ') ?? 'none'}`,
      );
    }

    // Find the pending main step_run for this review_gate step
    const mainStep = r.stepRuns.mainPending(a.run);
    if (!mainStep || mainStep.step_id !== a.step) {
      throw new ApmError(
        'E_CONFLICT',
        `step ${a.step} is not the current pending main step`,
      );
    }

    // Find the pending reviewer CHILD step_run for this role
    const children = r.stepRuns.reviewerChildren(mainStep.id);
    // Find the pending child for this role (latest round, pending status)
    const reviewerChild = children
      .filter((c: any) => c.role === a.reviewer && c.status === 'pending')
      .sort((a: any, b: any) => b.review_round - a.review_round)[0];

    if (!reviewerChild) {
      throw new ApmError(
        'E_NOT_FOUND',
        `no pending reviewer child step_run found for role '${a.reviewer}' on step '${a.step}'`,
      );
    }

    // Complete the reviewer child with the verdict
    r.stepRuns.complete(reviewerChild.id, { verdict: a.verdict, artifactId: a.artifactId ?? null });

    tx.appendEvent({
      actorId: a.agent, eventType: 'workflow_run.review_submitted', entityType: 'workflow_step_run',
      entityId: reviewerChild.id, payload: { stepId: a.step, reviewer: a.reviewer, verdict: a.verdict },
    });

    // Evaluate the gate: re-fetch all children after this update
    const allChildren = r.stepRuns.reviewerChildren(mainStep.id);

    // Get only the latest-round child per role (the one that matters for evaluation)
    const latestByRole = new Map<string, any>();
    for (const child of allChildren) {
      const existing = latestByRole.get(child.role);
      if (!existing || child.review_round > existing.review_round) {
        latestByRole.set(child.role, child);
      }
    }

    // Evaluate the gate outcome using latest-round children per required role
    const requiredRoles = stepDef.reviewers ?? [];

    // Determine if all required roles have a completed latest-round child
    const allComplete = requiredRoles.every((role) => {
      const child = latestByRole.get(role);
      return child && child.status === 'completed';
    });

    if (!allComplete) {
      // Some required role still has a pending child — wait for it
      return toRunView(r.runs.byId(a.run)!, defRow.name);
    }

    // All required roles are complete. Check if every one passed.
    const allPassed = requiredRoles.every((role) => {
      const child = latestByRole.get(role);
      return child && child.verdict === 'pass';
    });

    if (allPassed) {
      // Complete the review_gate main step → advance to next step
      completeMainStep(tx, def, runRow, mainStep, { artifactId: null }, a.agent);
    } else {
      // At least one role rejected or abstained.
      const nonPassingRoles = requiredRoles
        .filter((role) => {
          const child = latestByRole.get(role);
          return !child || child.verdict !== 'pass';
        })
        .join(', ');
      const onReject = stepDef.on_reject;
      // How many times has the on_reject (source) step already run? (revise rounds)
      const reviseCount = onReject
        ? (tx.get<{ c: number }>(
            "SELECT COUNT(*) c FROM workflow_step_runs WHERE workflow_run_id=? AND step_id=? AND parent_step_run_id IS NULL",
            a.run, onReject,
          )?.c ?? 0)
        : 0;
      if (onReject && reviseCount < MAX_REVISE_ROUNDS) {
        // Self-heal: fail the rejected gate step, re-open the source step for revision.
        // next then dispatches the source step (a revise); completing it flows back to a fresh review_gate.
        r.stepRuns.fail(mainStep.id, `review rejected by: ${nonPassingRoles}`);
        r.stepRuns.insertPending(a.run, onReject, null, null, reviseCount + 1);
        r.runs.setCurrentStep(a.run, onReject);
        // Keep the work item dispatchable (unblock only if nothing else blocks it).
        if (r.blockers.listOpen({ workItemId: runRow.work_item_id }).length === 0) {
          r.workItems.setStatus(runRow.work_item_id, 'ready', a.agent);
        }
        tx.appendEvent({
          actorId: a.agent, eventType: 'workflow_run.review_rejected_reopened', entityType: 'workflow_run',
          entityId: a.run, payload: { stepId: a.step, reopened: onReject, round: reviseCount + 1, nonPassingRoles },
        });
      } else {
        // No on_reject (or max revise rounds reached) → create review_disagreement blocker (human gate).
        r.blockers.insert({
          workItemId: runRow.work_item_id,
          type: 'review_disagreement',
          reason: `Review not passed by roles: ${nonPassingRoles}${onReject ? ` (max ${MAX_REVISE_ROUNDS} revise rounds reached)` : ''}`,
        });
        r.workItems.setStatus(runRow.work_item_id, 'blocked', a.agent);
      }
    }

    return toRunView(r.runs.byId(a.run)!, defRow.name);
  });
}

/** Read all step_runs for a run (main-path + reviewer children) for the run-state overlay. */
export function listForRun(ctx: Ctx, runId: string): StepRunView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    if (!r.runs.byId(runId)) throw new ApmError('E_NOT_FOUND', `run ${runId} not found`);
    return r.stepRuns.listForRun(runId).map(toStepRunView);
  });
}
