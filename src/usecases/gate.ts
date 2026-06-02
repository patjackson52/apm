import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { validateWorkflow, stepById } from '../domain/workflow.js';
import { completeMainStep } from '../domain/advance.js';
import { toBlockerView, toRunView, type BlockerView, type RunView } from '../domain/entities.js';

export interface GateView extends BlockerView {
  run_id: string | null;
}

export interface ListGatesArgs {
  workItem?: string | null;
}

export function list(ctx: Ctx, a: ListGatesArgs = {}): BlockerView[] {
  return ctx.storage.transaction('deferred', (tx) => {
    const rows = repos(tx).blockers.listOpen({ workItemId: a.workItem ?? undefined, type: 'human_gate' });
    return rows.map(toBlockerView);
  });
}

export interface AnswerGateArgs {
  choice: string;
  note?: string | null;
  agent: string;
}

export function answer(ctx: Ctx, blockerId: string, a: AnswerGateArgs): RunView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    const blocker = r.blockers.byId(blockerId);
    if (!blocker) throw new ApmError('E_NOT_FOUND', `blocker ${blockerId} not found`);
    if (blocker.status !== 'open') {
      throw new ApmError('E_PRECONDITION', `blocker ${blockerId} is not open (status: ${blocker.status})`);
    }
    if (blocker.blocker_type !== 'human_gate') {
      throw new ApmError('E_PRECONDITION', `blocker ${blockerId} is not a human_gate (type: ${blocker.blocker_type})`);
    }

    // Resolve the blocker with choice/answer
    r.blockers.resolve(blockerId, {
      choice: a.choice,
      answer: a.note ?? null,
      answeredBy: a.agent,
    });

    // Find the active run for the work item
    const run = r.runs.activeForWorkItem(blocker.work_item_id);
    if (!run) throw new ApmError('E_PRECONDITION', `no active run found for work item ${blocker.work_item_id}`);

    const defRow = r.defs.byId(run.workflow_definition_id);
    if (!defRow) throw new ApmError('E_INTERNAL', 'workflow definition not found');

    // def is stored as JSON object
    const defObj = JSON.parse(defRow.definition_json);
    validateWorkflow(defObj);

    // Find the human_gate step_run (status 'running') for this run
    const gateStepRun = tx.get<any>(
      "SELECT * FROM workflow_step_runs WHERE workflow_run_id=? AND status='running' AND parent_step_run_id IS NULL LIMIT 1",
      run.id,
    );
    if (!gateStepRun) {
      // Maybe already advanced — just unblock and return
      const remaining = r.blockers.listOpen({ workItemId: blocker.work_item_id });
      if (remaining.length === 0) {
        r.workItems.setStatus(blocker.work_item_id, 'ready', a.agent);
      }
      return toRunView(r.runs.byId(run.id)!, defRow.name);
    }

    // If the gated step is a decision step, record the human choice on the decision
    const gateStepDef = stepById(defObj, gateStepRun.step_id);
    if (gateStepDef?.type === 'decision') {
      const decRow = tx.get<any>(
        "SELECT * FROM decisions WHERE work_item_id=? AND status NOT IN ('decided','cancelled') ORDER BY id DESC LIMIT 1",
        blocker.work_item_id,
      );
      if (decRow) {
        r.decisions.setDecided(decRow.id, a.choice, null);
      }
    }

    // Complete the step_run → advance to next step
    completeMainStep(tx, defObj, run, gateStepRun, { artifactId: null }, a.agent);

    // Unblock work item if no remaining blockers
    const remaining = r.blockers.listOpen({ workItemId: blocker.work_item_id });
    if (remaining.length === 0) {
      // completeMainStep/enterStep may have already set the status via setStatus('completed')
      // Only set 'ready' if not already terminal
      const freshRun = r.runs.byId(run.id)!;
      if (freshRun.status !== 'completed' && freshRun.status !== 'cancelled') {
        r.workItems.setStatus(blocker.work_item_id, 'ready', a.agent);
      }
    }

    return toRunView(r.runs.byId(run.id)!, defRow.name);
  });
}
