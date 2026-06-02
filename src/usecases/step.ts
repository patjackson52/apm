import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { parseWorkflow, validateWorkflow, type WorkflowDef } from '../domain/workflow.js';
import { completeMainStep } from '../domain/advance.js';
import { toRunView, type RunView } from '../domain/entities.js';
import * as artifact from './artifact.js';

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
