"use client";
import { useState } from 'react';
import type { RunView } from '@apm/types';
import { useWorkflow, useRuns, useRunSteps, usePromptPanel } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { buildOverlay } from '@/lib/workflow/runOverlay';
import { WorkflowGraph } from './WorkflowGraph';
import { RunBanner } from './RunBanner';
import { RunLegend } from './RunLegend';
import { StepPopover } from './StepPopover';
import { useRunNext } from '@/lib/api/mutations';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import s from './RunGraph.module.css';

// Prefer an explicit runId; else the latest run by started_at desc (never array order).
function pickRun(runs: RunView[] | undefined, runId?: string): RunView | undefined {
  if (!runs || runs.length === 0) return undefined;
  if (runId) return runs.find((r) => r.id === runId);
  return [...runs].sort((a, b) => (b.started_at ?? '').localeCompare(a.started_at ?? ''))[0];
}

/** Workflow graph + live run-state overlay (status, current, reviewer verdicts, banner, popover). */
export function RunGraph({
  workflowId,
  workItemId,
  runId,
}: {
  workflowId: string;
  workItemId: string;
  runId?: string;
}) {
  const wf = useWorkflow(workflowId);
  const runsQ = useRuns(workItemId);
  const run = pickRun(runsQ.data, runId);
  const stepsQ = useRunSteps(run?.id ?? '');
  const panelQ = usePromptPanel(workItemId);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmNext, setConfirmNext] = useState(false);
  const runNext = useRunNext(workItemId);

  if (wf.isLoading || runsQ.isLoading) return <Skeleton count={6} h={40} />;
  if (wf.isError || !wf.data) return <p>Failed to load workflow.</p>;

  const overlay = buildOverlay(stepsQ.data ?? []);
  const selectedStep = wf.data.steps.find((st) => st.id === selected);

  return (
    <section>
      <div className={s.header}>
        <h1>{wf.data.name}</h1>
        <button type="button" className={s.nextBtn} onClick={() => setConfirmNext(true)}>Run next</button>
      </div>
      {run ? <RunBanner status={run.status} /> : null}
      <ConfirmDialog
        open={confirmNext}
        title="Dispatch the next action?"
        confirmLabel="Run next"
        pending={runNext.isPending}
        error={runNext.isError ? runNext.error.message : null}
        onOpenChange={(o) => { if (!o) setConfirmNext(false); }}
        onConfirm={() => runNext.mutate(undefined, { onSuccess: () => setConfirmNext(false) })}
      >
        Advances this work item by dispatching its next allowed step.
      </ConfirmDialog>
      <WorkflowGraph
        steps={wf.data.steps}
        edges={wf.data.edges}
        overlay={overlay}
        currentStep={run?.current_step}
        onSelectStep={setSelected}
      />
      <RunLegend />
      {selectedStep ? (
        <StepPopover
          step={{ id: selectedStep.id, type: selectedStep.type }}
          overlay={overlay.get(selectedStep.id)}
          dispatch={panelQ.data?.timeline.find((d) => d.step_id === selectedStep.id)}
          runId={run?.id}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
