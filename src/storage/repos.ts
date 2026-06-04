import type { Tx } from './storage.js';
import type { WorkItemType, Estimate, ArtifactType } from '../domain/types.js';

export interface NewWorkItem {
  type: WorkItemType; title: string; description: string | null;
  priority: number; estimate: Estimate | null; parentId: string | null; createdBy: string | null;
}

export interface NewArtifact {
  type: ArtifactType; title: string; body: string | null; createdBy: string;
  version: number; rootId?: string; supersedes?: string;
  metadata?: Record<string, unknown>;
}

export interface NewDecision {
  workItemId: string | null; question: string; optionsJson: string;
  recommendation?: string | null; confidence?: number | null; category?: string | null;
}

export interface NewBlocker {
  workItemId: string; type: string; reason: string;
  question?: string | null; optionsJson?: string | null;
}

export interface ResolveBlockerArgs {
  resolution?: string | null; answer?: string | null;
  choice?: string | null; answeredBy?: string | null;
}

export function repos(tx: Tx) {
  const now = tx.now();
  return {
    agents: {
      /** Ensure an agent row exists (id == name in V1). Idempotent. Returns the id. */
      ensure(name: string): string {
        const existing = tx.get<{ id: string }>('SELECT id FROM agents WHERE id=?', name);
        if (!existing) {
          tx.run('INSERT INTO agents (id, name, type, created_at) VALUES (?, ?, ?, ?)', name, name, name.startsWith('human:') ? 'human' : 'agent', now);
        }
        return name;
      },
      byId(id: string): any | undefined { return tx.get('SELECT * FROM agents WHERE id=?', id); },
    },
    workItems: {
      insert(w: NewWorkItem): string {
        const id = tx.allocateId('WI');
        tx.run(
          `INSERT INTO work_items (id, type, title, description, status, priority, estimate, parent_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)`,
          id, w.type, w.title, w.description, w.priority, w.estimate, w.parentId, w.createdBy, now, now,
        );
        tx.appendEvent({ actorId: w.createdBy, eventType: 'work_item.created', entityType: 'work_item', entityId: id, payload: { type: w.type, title: w.title } });
        return id;
      },
      byId(id: string): any | undefined { return tx.get('SELECT * FROM work_items WHERE id=?', id); },
      children(id: string): any[] { return tx.all('SELECT * FROM work_items WHERE parent_id=? ORDER BY id', id); },
      setStatus(id: string, status: string, actor: string | null, completedAt?: string | null) {
        tx.run('UPDATE work_items SET status=?, updated_at=?, completed_at=COALESCE(?, completed_at) WHERE id=?', status, now, completedAt ?? null, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.status', entityType: 'work_item', entityId: id, payload: { status } });
      },
      update(id: string, fields: Record<string, unknown>, actor: string | null) {
        const cols = Object.keys(fields);
        if (cols.length === 0) return;
        tx.run(`UPDATE work_items SET ${cols.map((c) => `${c}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((c) => fields[c]), now, id);
        tx.appendEvent({ actorId: actor, eventType: 'work_item.updated', entityType: 'work_item', entityId: id, payload: fields });
      },
    },
    links: {
      add(source: string, target: string, linkType: string) {
        const id = `${source}_${target}_${linkType}`;
        tx.run('INSERT OR IGNORE INTO work_item_links (id, source_work_item_id, target_work_item_id, link_type, created_at) VALUES (?, ?, ?, ?, ?)',
          id, source, target, linkType, now);
      },
      dependsOn(source: string): string[] {
        return tx.all<{ target_work_item_id: string }>(
          "SELECT target_work_item_id FROM work_item_links WHERE source_work_item_id=? AND link_type='depends_on' ORDER BY target_work_item_id", source,
        ).map((r) => r.target_work_item_id);
      },
      /** Reverse of dependsOn: work items that depend ON `target`. */
      dependents(target: string): string[] {
        return tx.all<{ source_work_item_id: string }>(
          "SELECT source_work_item_id FROM work_item_links WHERE target_work_item_id=? AND link_type='depends_on' ORDER BY source_work_item_id", target,
        ).map((r) => r.source_work_item_id);
      },
    },
    defs: {
      byNameVersion(name: string, version: number): any | undefined {
        return tx.get('SELECT * FROM workflow_definitions WHERE name=? AND version=?', name, version);
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM workflow_definitions WHERE id=?', id);
      },
      active(name: string): any | undefined {
        return tx.get("SELECT * FROM workflow_definitions WHERE name=? AND status='active' ORDER BY version DESC LIMIT 1", name);
      },
      register(def: { name: string; version: number; definitionJson: string }): string {
        const id = tx.allocateId('WD');
        tx.run(
          "INSERT INTO workflow_definitions (id, name, version, definition_json, status, created_at) VALUES (?, ?, ?, ?, 'active', ?)",
          id, def.name, def.version, def.definitionJson, now,
        );
        tx.appendEvent({ eventType: 'workflow.registered', entityType: 'workflow_definition', entityId: id, payload: { name: def.name, version: def.version } });
        return id;
      },
      list(): any[] {
        return tx.all('SELECT * FROM workflow_definitions ORDER BY name, version');
      },
    },
    runs: {
      insert(workItemId: string, defId: string): string {
        const id = tx.allocateId('WR');
        tx.run(
          "INSERT INTO workflow_runs (id, work_item_id, workflow_definition_id, status, started_at) VALUES (?, ?, ?, 'running', ?)",
          id, workItemId, defId, now,
        );
        tx.appendEvent({ eventType: 'workflow_run.started', entityType: 'workflow_run', entityId: id, payload: { workItemId, defId } });
        return id;
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM workflow_runs WHERE id=?', id);
      },
      activeForWorkItem(workItemId: string): any | undefined {
        return tx.get("SELECT * FROM workflow_runs WHERE work_item_id=? AND status IN ('pending','running','paused') LIMIT 1", workItemId);
      },
      setCurrentStep(runId: string, stepId: string) {
        tx.run('UPDATE workflow_runs SET current_step_id=? WHERE id=?', stepId, runId);
      },
      setStatus(runId: string, status: string, completedAt?: string | null) {
        tx.run('UPDATE workflow_runs SET status=?, completed_at=COALESCE(?,completed_at) WHERE id=?', status, completedAt ?? null, runId);
        tx.appendEvent({ eventType: 'workflow_run.status', entityType: 'workflow_run', entityId: runId, payload: { status } });
      },
      listForWorkItem(workItemId: string): any[] {
        return tx.all('SELECT * FROM workflow_runs WHERE work_item_id=? ORDER BY id', workItemId);
      },
    },
    stepRuns: {
      insertPending(runId: string, stepId: string, parent?: string | null, role?: string | null, round?: number): string {
        const id = tx.allocateId('SR');
        tx.run(
          "INSERT INTO workflow_step_runs (id, workflow_run_id, step_id, parent_step_run_id, role, status, review_round, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
          id, runId, stepId, parent ?? null, role ?? null, round ?? 1, now,
        );
        return id;
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM workflow_step_runs WHERE id=?', id);
      },
      mainPending(runId: string): any | undefined {
        return tx.get(
          "SELECT * FROM workflow_step_runs WHERE workflow_run_id=? AND parent_step_run_id IS NULL AND status IN ('pending','running') LIMIT 1",
          runId,
        );
      },
      reviewerChildren(parentId: string): any[] {
        return tx.all('SELECT * FROM workflow_step_runs WHERE parent_step_run_id=? ORDER BY id', parentId);
      },
      listForRun(runId: string): any[] {
        return tx.all('SELECT * FROM workflow_step_runs WHERE workflow_run_id=? ORDER BY id', runId);
      },
      setStatus(id: string, status: string, fields?: Record<string, unknown>) {
        const extra = fields ?? {};
        const cols = Object.keys(extra);
        const setCols = ['status=?', ...cols.map((c) => `${c}=?`)].join(', ');
        tx.run(`UPDATE workflow_step_runs SET ${setCols} WHERE id=?`, status, ...cols.map((c) => extra[c]), id);
      },
      complete(id: string, args?: { verdict?: string | null; artifactId?: string | null }) {
        tx.run(
          'UPDATE workflow_step_runs SET status=?, completed_at=?, verdict=COALESCE(?,verdict), output_artifact_id=COALESCE(?,output_artifact_id) WHERE id=?',
          'completed', now, args?.verdict ?? null, args?.artifactId ?? null, id,
        );
      },
      fail(id: string, reason: string) {
        tx.run("UPDATE workflow_step_runs SET status='failed', completed_at=?, failure_reason=? WHERE id=?", now, reason, id);
      },
    },
    artifacts: {
      insert(a: NewArtifact, eventType: string = 'artifact.created'): string {
        const id = tx.allocateId(a.type === 'image' ? 'IMG' : 'ART');
        // If no rootId provided (v1 artifact), root = own id
        const rootId = a.rootId ?? id;
        tx.run(
          "INSERT INTO artifacts (id, type, title, version, status, body, metadata_json, root_artifact_id, created_by, created_at, supersedes_artifact_id) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?)",
          id, a.type, a.title, a.version, a.body,
          a.metadata != null ? JSON.stringify(a.metadata) : null,
          rootId, a.createdBy, now, a.supersedes ?? null,
        );
        tx.appendEvent({
          actorId: a.createdBy,
          eventType,
          entityType: 'artifact',
          entityId: id,
          payload: { type: a.type, version: a.version },
        });
        return id;
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM artifacts WHERE id=?', id);
      },
      currentByRoot(rootId: string): any | undefined {
        return tx.get('SELECT * FROM artifacts WHERE root_artifact_id=? ORDER BY version DESC LIMIT 1', rootId);
      },
      linkToWorkItem(workItemId: string, rootId: string, relation: string) {
        tx.run(
          'INSERT OR IGNORE INTO work_item_artifacts (work_item_id, root_artifact_id, relation_type) VALUES (?, ?, ?)',
          workItemId, rootId, relation,
        );
      },
      linkedRoots(workItemId: string): string[] {
        return tx.all<{ root_artifact_id: string }>(
          'SELECT root_artifact_id FROM work_item_artifacts WHERE work_item_id=? ORDER BY root_artifact_id',
          workItemId,
        ).map((r) => r.root_artifact_id);
      },
      currentByTypeForWorkItem(workItemId: string, type: string): any | undefined {
        return tx.get(
          `SELECT a.* FROM artifacts a
           JOIN work_item_artifacts wia ON wia.root_artifact_id = a.root_artifact_id
           WHERE wia.work_item_id=? AND a.type=?
           ORDER BY a.version DESC LIMIT 1`,
          workItemId, type,
        );
      },
      setStatus(id: string, status: string) {
        tx.run('UPDATE artifacts SET status=? WHERE id=?', status, id);
        tx.appendEvent({ eventType: 'artifact.status', entityType: 'artifact', entityId: id, payload: { status } });
      },
      setSuperseded(id: string) {
        tx.run("UPDATE artifacts SET status='superseded' WHERE id=?", id);
      },
      linkedImages(workItemId: string): string[] {
        return tx.all<{ r: string }>(
          `SELECT wia.root_artifact_id AS r
           FROM work_item_artifacts wia
           JOIN artifacts a ON a.id = wia.root_artifact_id
           WHERE wia.work_item_id=? AND a.type='image'
           ORDER BY r`,
          workItemId,
        ).map((x) => x.r);
      },
      imagesByBlob(sha256: string): any[] {
        return tx.all(
          "SELECT * FROM artifacts WHERE type='image' AND json_extract(metadata_json,'$.blob')=? ORDER BY id",
          sha256,
        );
      },
    },
    blobs: {
      insert(m: { sha256: string; mime: string; ext: string; byte_size: number; width: number | null; height: number | null }) {
        tx.run(
          'INSERT OR IGNORE INTO blobs (sha256, mime, ext, byte_size, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          m.sha256, m.mime, m.ext, m.byte_size, m.width, m.height, now,
        );
      },
      byId(sha256: string): any | undefined {
        return tx.get('SELECT * FROM blobs WHERE sha256=?', sha256);
      },
    },
    decisions: {
      insert(d: NewDecision): string {
        const id = tx.allocateId('DEC');
        tx.run(
          "INSERT INTO decisions (id, work_item_id, question, options_json, recommendation, confidence, category, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
          id, d.workItemId, d.question, d.optionsJson, d.recommendation ?? null, d.confidence ?? null, d.category ?? null, now,
        );
        tx.appendEvent({ eventType: 'decision.created', entityType: 'decision', entityId: id, payload: { question: d.question } });
        return id;
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM decisions WHERE id=?', id);
      },
      setDecided(id: string, choice: string, artifactId?: string | null) {
        tx.run(
          "UPDATE decisions SET status='decided', decision=?, artifact_id=COALESCE(?,artifact_id), decided_at=? WHERE id=?",
          choice, artifactId ?? null, now, id,
        );
        tx.appendEvent({ eventType: 'decision.decided', entityType: 'decision', entityId: id, payload: { choice } });
      },
      setStatus(id: string, status: string) {
        tx.run('UPDATE decisions SET status=? WHERE id=?', status, id);
        tx.appendEvent({ eventType: 'decision.status', entityType: 'decision', entityId: id, payload: { status } });
      },
    },
    blockers: {
      insert(b: NewBlocker): string {
        const id = tx.allocateId('BLK');
        tx.run(
          "INSERT INTO blockers (id, work_item_id, blocker_type, reason, status, question, options_json, created_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)",
          id, b.workItemId, b.type, b.reason, b.question ?? null, b.optionsJson ?? null, now,
        );
        tx.appendEvent({ eventType: 'blocker.created', entityType: 'blocker', entityId: id, payload: { type: b.type, workItemId: b.workItemId } });
        return id;
      },
      byId(id: string): any | undefined {
        return tx.get('SELECT * FROM blockers WHERE id=?', id);
      },
      openForWorkItem(workItemId: string): any[] {
        return tx.all("SELECT * FROM blockers WHERE work_item_id=? AND status='open' ORDER BY id", workItemId);
      },
      resolve(id: string, args: ResolveBlockerArgs) {
        tx.run(
          "UPDATE blockers SET status='resolved', resolution=COALESCE(?,resolution), answer=COALESCE(?,answer), choice=COALESCE(?,choice), answered_by=COALESCE(?,answered_by), answered_at=COALESCE(?,answered_at), resolved_at=? WHERE id=?",
          args.resolution ?? null, args.answer ?? null, args.choice ?? null, args.answeredBy ?? null,
          args.answeredBy ? now : null, now, id,
        );
        tx.appendEvent({ eventType: 'blocker.resolved', entityType: 'blocker', entityId: id, payload: args });
      },
      listOpen(filter: { workItemId?: string; type?: string }): any[] {
        const where: string[] = ["status='open'"];
        const params: unknown[] = [];
        if (filter.workItemId) { where.push('work_item_id=?'); params.push(filter.workItemId); }
        if (filter.type) { where.push('blocker_type=?'); params.push(filter.type); }
        return tx.all(`SELECT * FROM blockers WHERE ${where.join(' AND ')} ORDER BY id`, ...params);
      },
    },
    policies: {
      global(): any | undefined {
        return tx.get("SELECT * FROM policies WHERE scope_type='global' LIMIT 1");
      },
      forWorkItem(workItemId: string): any | undefined {
        return tx.get("SELECT * FROM policies WHERE scope_type='work_item' AND scope_id=? LIMIT 1", workItemId);
      },
    },
    prompts: {
      insert(name: string, body: string): string {
        const id = tx.allocateId('PD');
        // Auto-increment version per name
        const prev = tx.get<{ version: number }>('SELECT MAX(version) version FROM prompt_definitions WHERE name=?', name);
        const version = (prev?.version ?? 0) + 1;
        tx.run(
          'INSERT INTO prompt_definitions (id, name, version, body, created_at) VALUES (?, ?, ?, ?, ?)',
          id, name, version, body, now,
        );
        tx.appendEvent({ eventType: 'prompt.created', entityType: 'prompt_definition', entityId: id, payload: { name, version } });
        return id;
      },
      byName(name: string): any | undefined {
        return tx.get('SELECT * FROM prompt_definitions WHERE name=? ORDER BY version DESC LIMIT 1', name);
      },
      list(): any[] {
        return tx.all('SELECT * FROM prompt_definitions ORDER BY name, version');
      },
    },
  };
}
