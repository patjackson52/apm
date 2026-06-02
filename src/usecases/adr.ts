import type { Ctx } from '../cli/run.js';
import { ApmError } from '../domain/errors.js';
import { repos } from '../storage/repos.js';
import { toArtifactView, type ArtifactView, type Page } from '../domain/entities.js';

export function createFromDecision(ctx: Ctx, decId: string, agent: string): ArtifactView {
  return ctx.storage.transaction('immediate', (tx) => {
    const r = repos(tx);
    r.agents.ensure(agent);

    const decRow = r.decisions.byId(decId);
    if (!decRow) throw new ApmError('E_NOT_FOUND', `decision ${decId} not found`);
    if (decRow.status !== 'decided') {
      throw new ApmError('E_PRECONDITION', `decision ${decId} must be 'decided' to create an ADR (current: ${decRow.status})`);
    }
    if (decRow.artifact_id) {
      throw new ApmError('E_CONFLICT', 'decision already has an ADR');
    }

    const body = `# Decision\n\n**Question:** ${decRow.question}\n\n**Decision:** ${decRow.decision}\n\n**Category:** ${decRow.category ?? 'N/A'}\n\n**Confidence:** ${decRow.confidence ?? 'N/A'}%`;

    const artId = r.artifacts.insert({
      type: 'adr',
      title: decRow.question,
      body,
      createdBy: agent,
      version: 1,
    });

    if (decRow.work_item_id) {
      r.artifacts.linkToWorkItem(decRow.work_item_id, artId, 'decision');
    }

    // Link artifact to the decision
    tx.run('UPDATE decisions SET artifact_id=? WHERE id=?', artId, decId);

    tx.appendEvent({
      actorId: agent, eventType: 'adr.created', entityType: 'artifact',
      entityId: artId, payload: { decisionId: decId },
    });

    return toArtifactView(r.artifacts.byId(artId)!);
  });
}

export function list(ctx: Ctx): Page<ArtifactView> {
  return ctx.storage.transaction('deferred', (tx) => {
    const rows = tx.all<any>("SELECT * FROM artifacts WHERE type='adr' ORDER BY id");
    return {
      items: rows.map(toArtifactView),
      page: { total: rows.length, limit: rows.length, offset: 0, has_more: false },
    };
  });
}

export function show(ctx: Ctx, id: string): ArtifactView {
  return ctx.storage.transaction('deferred', (tx) => {
    const r = repos(tx);
    const row = r.artifacts.byId(id);
    if (!row) throw new ApmError('E_NOT_FOUND', `artifact ${id} not found`);
    if (row.type !== 'adr') throw new ApmError('E_NOT_FOUND', `artifact ${id} is not an ADR`);
    return toArtifactView(row);
  });
}
