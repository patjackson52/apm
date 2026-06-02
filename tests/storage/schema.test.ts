import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const schema = readFileSync(fileURLToPath(new URL('../../src/storage/schema.sql', import.meta.url)), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(schema);
  return db;
}

describe('schema', () => {
  it('applies cleanly', () => {
    const db = freshDb();
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name);
    for (const t of ['work_items', 'leases', 'workflow_runs', 'workflow_step_runs', 'artifacts',
      'blockers', 'decisions', 'policies', 'events', 'sequences', 'schema_migrations',
      'agents', 'sessions', 'workflow_definitions', 'prompt_definitions', 'work_item_links', 'work_item_artifacts']) {
      expect(tables).toContain(t);
    }
    db.close();
  });

  it('rejects an invalid work_item status via CHECK', () => {
    const db = freshDb();
    const insert = () => db.prepare(
      "INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','bogus','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')"
    ).run();
    expect(insert).toThrow(/CHECK/i);
    db.close();
  });

  it('enforces one active lease per work item', () => {
    const db = freshDb();
    db.exec("INSERT INTO agents (id,name,type,created_at) VALUES ('A','claude','agent','2026-06-02T00:00:00.000Z')");
    db.exec("INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','ready','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')");
    const lease = (id: string) => db.prepare(
      "INSERT INTO leases (id,work_item_id,agent_id,status,acquired_at,expires_at) VALUES (?, 'WI-1','A','active','2026-06-02T00:00:00.000Z','2026-06-02T01:00:00.000Z')"
    ).run(id);
    lease('LEASE-1');
    expect(() => lease('LEASE-2')).toThrow(/UNIQUE/i);
    db.close();
  });

  it('blocks a human_gate blocker resolved without an answer', () => {
    const db = freshDb();
    db.exec("INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','blocked','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')");
    const bad = () => db.prepare(
      "INSERT INTO blockers (id,work_item_id,blocker_type,reason,status,question,options_json,created_at) VALUES ('BLK-1','WI-1','human_gate','need decision','resolved','Which?','[\"a\",\"b\"]','2026-06-02T00:00:00.000Z')"
    ).run();
    expect(bad).toThrow(/CHECK/i);
    db.close();
  });

  it('makes workflow_definitions immutable once inserted', () => {
    const db = freshDb();
    db.exec("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES ('WD-1','feature_delivery',1,'{}','active','2026-06-02T00:00:00.000Z')");
    expect(() => db.exec("UPDATE workflow_definitions SET definition_json='{\"x\":1}' WHERE id='WD-1'")).toThrow(/immutable/i);
    expect(() => db.exec("UPDATE workflow_definitions SET status='deprecated' WHERE id='WD-1'")).not.toThrow();
    db.close();
  });

  it('blocks DELETE on workflow_definitions', () => {
    const db = freshDb();
    db.exec("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES ('WD-1','feature_delivery',1,'{}','active','2026-06-02T00:00:00.000Z')");
    expect(() => db.exec("DELETE FROM workflow_definitions WHERE id='WD-1'")).toThrow(/immutable/i);
    db.close();
  });

  it('blocks verdict on main-path step run (parent_step_run_id IS NULL)', () => {
    const db = freshDb();
    db.exec("INSERT INTO agents (id,name,type,created_at) VALUES ('A','claude','agent','2026-06-02T00:00:00.000Z')");
    db.exec("INSERT INTO work_items (id,type,title,status,created_at,updated_at) VALUES ('WI-1','feature','t','ready','2026-06-02T00:00:00.000Z','2026-06-02T00:00:00.000Z')");
    db.exec("INSERT INTO workflow_definitions (id,name,version,definition_json,status,created_at) VALUES ('WD-1','flow',1,'{}','active','2026-06-02T00:00:00.000Z')");
    db.exec("INSERT INTO workflow_runs (id,work_item_id,workflow_definition_id,status) VALUES ('WR-1','WI-1','WD-1','running')");
    const bad = () => db.exec(
      "INSERT INTO workflow_step_runs (id,workflow_run_id,step_id,parent_step_run_id,role,status,verdict,created_at) VALUES ('SR-1','WR-1','step-1',NULL,NULL,'pending','pass','2026-06-02T00:00:00.000Z')"
    );
    expect(bad).toThrow(/CHECK/i);
    db.close();
  });

  it('blocks artifact with version 0', () => {
    const db = freshDb();
    const bad = () => db.exec(
      "INSERT INTO artifacts (id,type,title,version,status,root_artifact_id,created_at) VALUES ('ART-1','doc','title',0,'draft','ART-1','2026-06-02T00:00:00.000Z')"
    );
    expect(bad).toThrow(/CHECK/i);
    db.close();
  });

  it('has ix_wi_status and ix_wi_parent indexes', () => {
    const db = freshDb();
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('ix_wi_status','ix_wi_parent')"
    ).all().map((r: any) => r.name);
    expect(names).toContain('ix_wi_status');
    expect(names).toContain('ix_wi_parent');
    db.close();
  });
});
