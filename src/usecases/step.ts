import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { validateWorkflow, type WorkflowDef, stepById } from '../domain/workflow.js';
import { completeMainStep } from '../domain/advance.js';
import { toRunView, type RunView } from '../domain/entities.js';
import { REVIEW_VERDICTS, type ReviewVerdict } from '../domain/types.js';

export interface CompleteArgs {
  run: string;
  step: string;
  agent: string;
  artifactId?: string | null;
  artifactType?: string | null;
  bodyFile?: string | null;
}

export function complete(ctx: Ctx, a: CompleteArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
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

    completeMainStep(tx, def, runRow, mainStep, { artifactId: resolvedArtifactId }, a.agent);

    const updatedRun = r.runs.byId(a.run)!;
    return toRunView(updatedRun, defRow.name);
  });
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
      // At least one role rejected or abstained → create review_disagreement blocker
      const nonPassingRoles = requiredRoles
        .filter((role) => {
          const child = latestByRole.get(role);
          return !child || child.verdict !== 'pass';
        })
        .join(', ');
      r.blockers.insert({
        workItemId: runRow.work_item_id,
        type: 'review_disagreement',
        reason: `Review not passed by roles: ${nonPassingRoles}`,
      });
      r.workItems.setStatus(runRow.work_item_id, 'blocked', a.agent);
    }

    return toRunView(r.runs.byId(a.run)!, defRow.name);
  });
}
