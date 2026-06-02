import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { effectivePolicy } from '../domain/policy.js';
import { toDecisionView, toArtifactView, type DecisionView } from '../domain/entities.js';

export interface CreateDecisionArgs {
  workItem?: string | null;
  question: string;
  options: string[];
  recommendation?: string | null;
  confidence?: number | null;
  category?: string | null;
  agent: string;
}

export function create(ctx: Ctx, a: CreateDecisionArgs): DecisionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(a.agent);

    if (a.workItem && !r.workItems.byId(a.workItem)) {
      throw new ApmError('E_NOT_FOUND', `work item ${a.workItem} not found`);
    }

    const status = a.recommendation ? 'recommended' : 'open';

    const id = r.decisions.insert({
      workItemId: a.workItem ?? null,
      question: a.question,
      optionsJson: JSON.stringify(a.options),
      recommendation: a.recommendation ?? null,
      confidence: a.confidence ?? null,
      category: a.category ?? null,
    });

    if (status === 'recommended') {
      r.decisions.setStatus(id, 'recommended');
    }

    return toDecisionView(r.decisions.byId(id)!);
  });
}

export function accept(ctx: Ctx, decId: string, choice: string, agent: string): DecisionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(agent);

    const decRow = r.decisions.byId(decId);
    if (!decRow) throw new ApmError('E_NOT_FOUND', `decision ${decId} not found`);
    if (decRow.status === 'decided') throw new ApmError('E_PRECONDITION', `decision ${decId} already decided`);
    if (decRow.status === 'cancelled') throw new ApmError('E_PRECONDITION', `decision ${decId} is cancelled`);

    let artifactId: string | null = null;

    // Policy check for auto-create ADR
    if (decRow.work_item_id) {
      const policy = effectivePolicy(tx, decRow.work_item_id);
      const adrPolicy = (policy as any).adr_policy;
      if (adrPolicy?.auto_create) {
        const categories: string[] = adrPolicy.categories ?? [];
        const threshold: number = adrPolicy.confidence_threshold ?? 100;
        const confidence: number = decRow.confidence ?? 0;

        if (
          decRow.category && categories.includes(decRow.category) &&
          confidence >= threshold
        ) {
          // Create an ADR artifact in the same txn
          const adrBody = `# Decision\n\n**Question:** ${decRow.question}\n\n**Decision:** ${choice}\n\n**Category:** ${decRow.category}\n\n**Confidence:** ${confidence}%`;
          const artId = r.artifacts.insert({
            type: 'adr',
            title: decRow.question,
            body: adrBody,
            createdBy: agent,
            version: 1,
          });
          if (decRow.work_item_id) {
            r.artifacts.linkToWorkItem(decRow.work_item_id, artId, 'decision');
          }
          artifactId = artId;
          tx.appendEvent({
            actorId: agent, eventType: 'adr.auto_created', entityType: 'artifact',
            entityId: artId, payload: { decisionId: decId },
          });
        }
      }
    }

    r.decisions.setDecided(decId, choice, artifactId);
    return toDecisionView(r.decisions.byId(decId)!);
  });
}

export function reject(ctx: Ctx, decId: string, agent: string): DecisionView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(agent);

    const decRow = r.decisions.byId(decId);
    if (!decRow) throw new ApmError('E_NOT_FOUND', `decision ${decId} not found`);
    if (['decided', 'cancelled'].includes(decRow.status)) {
      throw new ApmError('E_PRECONDITION', `decision is already ${decRow.status}`);
    }

    r.decisions.setStatus(decId, 'cancelled');
    return toDecisionView(r.decisions.byId(decId)!);
  });
}

export function show(ctx: Ctx, id: string): DecisionView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.decisions.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `decision ${id} not found`);
    return toDecisionView(row);
  });
}

export function list(ctx: Ctx, workItem?: string | null) {
  return ctx.storage.transaction('deferred', (tx) => {
    let rows: any[];
    if (workItem) {
      rows = tx.all('SELECT * FROM decisions WHERE work_item_id=? ORDER BY id', workItem);
    } else {
      rows = tx.all('SELECT * FROM decisions ORDER BY id');
    }
    return rows.map(toDecisionView);
  });
}
