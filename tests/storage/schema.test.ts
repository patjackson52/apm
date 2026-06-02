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
});
