'use client';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { RunViewSchema, type RunView } from '@apm/types';
import { apiMutate, ApiError } from './client';
import { useCsrfToken, useRefetchCsrf } from './csrf';

/** Writes from the viewer are attributed to the human at the keyboard. */
export const VIEWER_AGENT = 'human:viewer';

/** NextResult is a `data: any` discriminated union in core; the viewer only needs the
 *  discriminant to know what happened, then refetches via cache invalidation. */
const NextResultLooseSchema = z
  .object({ status: z.enum(['dispatched', 'idle', 'drained']) })
  .passthrough();
type NextResultLoose = z.infer<typeof NextResultLooseSchema>;

/** Invalidate every query whose key contains any of the given segments — robust to the
 *  project-scoping prefix (`['project', id, ...]`) that hooks.ts prepends. */
function invalidate(qc: QueryClient, ...segments: string[]) {
  const want = new Set(segments);
  return qc.invalidateQueries({
    predicate: (q) => q.queryKey.some((k) => typeof k === 'string' && want.has(k)),
  });
}

/** Run a write, transparently recovering once from a rotated/stale CSRF token (403). */
function useGuardedMutate() {
  const token = useCsrfToken();
  const refetchToken = useRefetchCsrf();
  return async function guardedMutate<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let tok = token.data?.token ?? (await refetchToken()).token;
    try {
      return await apiMutate<T>(path, body, schema, tok);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'E_CSRF') {
        tok = (await refetchToken()).token; // token rotated (daemon restart) → refetch + retry once
        return await apiMutate<T>(path, body, schema, tok);
      }
      throw e;
    }
  };
}

export interface AnswerGateVars { blocker: string; choice: string; note?: string; agent?: string }

/** Answer a human gate / decision blocker. */
export function useAnswerGate() {
  const qc = useQueryClient();
  const guardedMutate = useGuardedMutate();
  return useMutation<RunView, ApiError, AnswerGateVars>({
    mutationFn: ({ blocker, choice, note, agent }) =>
      guardedMutate(`/api/gates/${blocker}/answer`, { choice, note, agent: agent ?? VIEWER_AGENT }, RunViewSchema),
    onSuccess: () => invalidate(qc, 'gates', 'blockers', 'status', 'runs', 'work', 'leases'),
  });
}

export interface RunNextVars { agent?: string }

/** Dispatch the next allowed action on a work item (advance the run). */
export function useRunNext(workItemId: string) {
  const qc = useQueryClient();
  const guardedMutate = useGuardedMutate();
  return useMutation<NextResultLoose, ApiError, RunNextVars | void>({
    mutationFn: (vars) =>
      guardedMutate(
        `/api/work/${workItemId}/next`,
        { agent: (vars && 'agent' in vars && vars.agent) || VIEWER_AGENT },
        NextResultLooseSchema,
      ),
    onSuccess: () => invalidate(qc, 'status', 'runs', 'work', 'gates', 'leases', 'blockers'),
  });
}

export type StepActionKind = 'complete' | 'fail' | 'retry';
export interface StepActionVars { agent?: string; reason?: string; artifact?: string }

/** Complete / fail / retry a workflow step. `reason` is required by core for `fail`. */
export function useStepAction(run: string, step: string, kind: StepActionKind) {
  const qc = useQueryClient();
  const guardedMutate = useGuardedMutate();
  return useMutation<RunView, ApiError, StepActionVars | void>({
    mutationFn: (vars) =>
      guardedMutate(
        `/api/runs/${run}/steps/${step}/${kind}`,
        { ...(vars ?? {}), agent: (vars && vars.agent) || VIEWER_AGENT },
        RunViewSchema,
      ),
    onSuccess: () => invalidate(qc, 'runs', 'status', 'work', 'gates', 'leases'),
  });
}
