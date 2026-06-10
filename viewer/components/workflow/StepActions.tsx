"use client";
import { useState } from 'react';
import { useStepAction, type StepActionKind } from '@/lib/api/mutations';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import s from './StepPopover.module.css';

/**
 * Complete / fail / retry controls for a run step. Complete is one click; fail and retry
 * are confirmable (fail also collects a required reason). Each posts via useStepAction
 * (CSRF-guarded) and invalidates run/step/status queries on success.
 */
export function StepActions({ runId, stepId, status }: { runId: string; stepId: string; status: string }) {
  const [confirm, setConfirm] = useState<StepActionKind | null>(null);
  const [reason, setReason] = useState('');
  const complete = useStepAction(runId, stepId, 'complete');
  const fail = useStepAction(runId, stepId, 'fail');
  const retry = useStepAction(runId, stepId, 'retry');

  const isDone = status === 'completed';
  const isFailed = status === 'failed';
  const active = confirm === 'fail' ? fail : retry;

  return (
    <div className={s.actions}>
      {!isDone ? (
        <button type="button" className={s.actBtn} disabled={complete.isPending} onClick={() => complete.mutate()}>
          {complete.isPending ? '…' : 'Complete'}
        </button>
      ) : null}
      {isFailed ? (
        <button type="button" className={s.actBtn} onClick={() => setConfirm('retry')}>Retry</button>
      ) : null}
      {!isDone ? (
        <button type="button" className={`${s.actBtn} ${s.actDanger}`} onClick={() => setConfirm('fail')}>Fail</button>
      ) : null}
      {complete.isError ? <span className={s.actErr} role="alert">{complete.error.message}</span> : null}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'fail' ? `Fail step ${stepId}?` : `Retry step ${stepId}?`}
        confirmLabel={confirm === 'fail' ? 'Fail step' : 'Retry step'}
        danger={confirm === 'fail'}
        pending={active.isPending}
        error={active.isError ? active.error.message : null}
        onOpenChange={(o) => { if (!o) { setConfirm(null); setReason(''); } }}
        onConfirm={() => {
          if (confirm === 'fail') {
            fail.mutate({ reason: reason.trim() || 'failed via viewer' }, { onSuccess: () => { setConfirm(null); setReason(''); } });
          } else {
            retry.mutate(undefined, { onSuccess: () => setConfirm(null) });
          }
        }}
      >
        {confirm === 'fail' ? (
          <input
            className={s.reason}
            placeholder="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="failure reason"
          />
        ) : (
          <>This re-opens the step for another attempt.</>
        )}
      </ConfirmDialog>
    </div>
  );
}
