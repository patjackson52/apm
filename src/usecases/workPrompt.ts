import type { Ctx } from '../cli/run.js';
import { repos } from '../storage/repos.js';
import { buildContract } from '../domain/contract.js';
import { renderDispatchPrompt, parseDispatchPrompt, type DispatchPayload, type ContextRef } from '../domain/dispatchGrammar.js';
import { stepById } from '../domain/workflow.js';
import { toImageView } from '../domain/entities.js';

export type PromptPanelState = 'pre-run' | 'active' | 'completed' | 'blocked' | 'no-prompt' | 'no-workflow';

export interface StructuredDispatch {
  step_id: string;
  step_type: string;
  status: string;
  prompt_name: string | null;
  prompt_version: number | null;
  latest_version: number | null;
  body: string | null;
  scaffold: { allowed_action: string | null; required_context: string[]; do_not: string[]; when_done: string[] };
  raw: string;
  at: string | null;
}

export interface PromptPanelView {
  state: PromptPanelState;
  headline: StructuredDispatch | null;
  timeline: StructuredDispatch[];
  provenance: { name: string; version: number; latest: number } | null;
}

/** Compose the dispatch payload for a pending agent_prompt step — mirrors next.ts
 *  exactly (parity enforced by a byte-equality test), so a preview equals the dispatch. */
export function buildPreviewPayload(r: ReturnType<typeof repos>, workItemId: string, runRow: any, stepDef: any): DispatchPayload {
  const requiredContext: ContextRef[] = [];
  for (const artType of stepDef.requires?.artifacts ?? []) {
    const art = r.artifacts.currentByTypeForWorkItem(workItemId, artType);
    if (!art) continue;
    const ref: ContextRef = { id: art.id, version: art.version, type: art.type, title: art.title, one_line: art.title };
    if (art.type === 'image') {
      const v = toImageView(art, workItemId);
      ref.path = v.path; ref.blob = v.blob;
      if (v.alt != null) ref.alt = v.alt;
      ref.one_line = v.alt ?? art.title;
    }
    requiredContext.push(ref);
  }
  const contract = buildContract(stepDef, requiredContext, { workItem: workItemId, run: runRow.id, session: '<session>' });
  let name: string | null = null, version: number | null = null, body: string | null = null;
  if (stepDef.prompt_id) {
    const pd = r.prompts.byName(stepDef.prompt_id);
    if (pd) { name = pd.name; version = pd.version; body = pd.body; }
  }
  return {
    work_item: workItemId,
    step: { id: stepDef.id, type: stepDef.type },
    prompt_name: name, prompt_version: version, prompt_body: body,
    allowed_action: contract.allowed_action,
    required_context: requiredContext,
    required_captures: stepDef.requires?.captures ?? [],
    do_not: contract.do_not, when_done: contract.when_done,
  };
}

/** Build a StructuredDispatch by parsing a rendered/snapshotted contract — one code
 *  path for pre-run previews and active/completed snapshots, so they read identically. */
function structuredFrom(r: ReturnType<typeof repos>, def: any, raw: string, o: { step_id: string; status: string; at: string | null }): StructuredDispatch {
  const p = parseDispatchPrompt(raw);
  const name = p.prompt?.name ?? null;
  const version = p.prompt?.version ?? null;
  const latest = name ? (r.prompts.byName(name)?.version ?? version) : null;
  const sd = stepById(def, o.step_id);
  return {
    step_id: o.step_id, step_type: sd?.type ?? 'agent_prompt', status: o.status,
    prompt_name: name, prompt_version: version, latest_version: latest,
    body: p.prompt?.body ?? null,
    scaffold: { allowed_action: p.allowed_action, required_context: p.required_context, do_not: p.do_not, when_done: p.when_done },
    raw, at: o.at,
  };
}

export function promptPanel(ctx: Ctx, workItemId: string): PromptPanelView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const run = r.runs.activeForWorkItem(workItemId) ?? r.runs.listForWorkItem(workItemId).at(-1);
    if (!run) return { state: 'no-workflow', headline: null, timeline: [], provenance: null };
    const def = JSON.parse(r.defs.byId(run.workflow_definition_id).definition_json);

    // Timeline = every main agent_prompt step run that has been dispatched, in run order.
    const mains = r.stepRuns.listForRun(run.id).filter((s: any) => s.parent_step_run_id == null);
    const dispatches: StructuredDispatch[] = [];
    for (const sr of mains) {
      const sd = stepById(def, sr.step_id);
      if (!sd || sd.type !== 'agent_prompt' || !sr.dispatch_prompt) continue;
      dispatches.push(structuredFrom(r, def, sr.dispatch_prompt, { step_id: sr.step_id, status: sr.status, at: sr.started_at ?? null }));
    }

    const pending = r.stepRuns.mainPending(run.id);
    const pendingDef = pending ? stepById(def, pending.step_id) : null;

    let state: PromptPanelState;
    let headline: StructuredDispatch | null;
    if (pending && pendingDef?.type === 'agent_prompt') {
      if (pending.dispatch_prompt) {
        // already dispatched (lease held, agent working) — active
        state = 'active';
        headline = structuredFrom(r, def, pending.dispatch_prompt, { step_id: pending.step_id, status: pending.status, at: pending.started_at ?? null });
      } else {
        // not yet dispatched — preview what will run
        state = 'pre-run';
        headline = structuredFrom(r, def, renderDispatchPrompt(buildPreviewPayload(r, workItemId, run, pendingDef)), { step_id: pendingDef.id, status: 'preview', at: null });
      }
    } else if (pendingDef?.type === 'human_gate' && dispatches.length > 0) {
      state = 'blocked'; headline = dispatches[dispatches.length - 1]!;
    } else if (dispatches.length > 0) {
      state = 'completed'; headline = dispatches[0]!; // "Started with" — the kickoff dispatch
    } else {
      state = 'no-prompt'; headline = null;
    }

    const provenance = headline && headline.prompt_name && headline.prompt_version != null
      ? { name: headline.prompt_name, version: headline.prompt_version, latest: headline.latest_version ?? headline.prompt_version }
      : null;
    return { state, headline, timeline: dispatches, provenance };
  });
}
