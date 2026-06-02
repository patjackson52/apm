-- APM V1 schema. Timestamps are TEXT, strict UTC ISO-8601 with Z.
-- foreign_keys is enabled by the connection; ON DELETE RESTRICT everywhere (soft-delete via status).

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE sequences (
  prefix TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capabilities TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('draft','ready','blocked','completed','cancelled')),
  priority INTEGER NOT NULL DEFAULT 0,
  estimate TEXT CHECK (estimate IS NULL OR estimate IN ('XS','S','M','L','XL')),
  parent_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(parent_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES agents(id) ON DELETE RESTRICT
);

CREATE INDEX ix_wi_status ON work_items(status);
CREATE INDEX ix_wi_parent ON work_items(parent_id);

CREATE TABLE work_item_links (
  id TEXT PRIMARY KEY,
  source_work_item_id TEXT NOT NULL,
  target_work_item_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(target_work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_link ON work_item_links(source_work_item_id, target_work_item_id, link_type);
CREATE INDEX ix_link_type ON work_item_links(link_type, source_work_item_id, target_work_item_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','idle','ended')),
  context_summary TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT,
  ended_at TEXT,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_session_live ON sessions(agent_id) WHERE status IN ('active','idle');

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','released','expired')),
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE RESTRICT,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_active_lease ON leases(work_item_id) WHERE status='active';
CREATE INDEX ix_leases_wi ON leases(work_item_id, status);
CREATE INDEX ix_leases_expiry ON leases(status, expires_at);

CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','active','deprecated','archived')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_wfdef_ver ON workflow_definitions(name, version);

CREATE TRIGGER wd_immutable BEFORE UPDATE OF definition_json, version ON workflow_definitions
WHEN OLD.definition_json <> NEW.definition_json OR OLD.version <> NEW.version
BEGIN
  SELECT RAISE(ABORT, 'workflow_definition is immutable');
END;

CREATE TRIGGER wd_no_delete BEFORE DELETE ON workflow_definitions
BEGIN
  SELECT RAISE(ABORT, 'workflow_definition is immutable');
END;

CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX ux_prompt_ver ON prompt_definitions(name, version);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  workflow_definition_id TEXT NOT NULL,
  current_step_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','paused','completed','failed','cancelled')),
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_wr_active ON workflow_runs(work_item_id) WHERE status IN ('pending','running','paused');
CREATE INDEX ix_runs_wi ON workflow_runs(work_item_id, status);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status TEXT NOT NULL CHECK (status IN ('draft','review','approved','superseded','archived')),
  body TEXT,
  metadata_json TEXT,
  root_artifact_id TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  supersedes_artifact_id TEXT,
  FOREIGN KEY(supersedes_artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  FOREIGN KEY(created_by) REFERENCES agents(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX ux_artifact_supersedes ON artifacts(supersedes_artifact_id) WHERE supersedes_artifact_id IS NOT NULL;
CREATE UNIQUE INDEX ux_artifact_version ON artifacts(root_artifact_id, version);
CREATE INDEX ix_artifacts_root ON artifacts(root_artifact_id, version);

CREATE TABLE work_item_artifacts (
  work_item_id TEXT NOT NULL,
  root_artifact_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY(work_item_id, root_artifact_id),
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(root_artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT
);

CREATE TABLE workflow_step_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  parent_step_run_id TEXT,
  role TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','skipped')),
  verdict TEXT CHECK (verdict IS NULL OR verdict IN ('pass','reject','abstain')),
  review_round INTEGER NOT NULL DEFAULT 1,
  prompt_definition_id TEXT,
  started_at TEXT,
  completed_at TEXT,
  output_artifact_id TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_run_id) REFERENCES workflow_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY(parent_step_run_id) REFERENCES workflow_step_runs(id) ON DELETE RESTRICT,
  FOREIGN KEY(prompt_definition_id) REFERENCES prompt_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY(output_artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  CHECK ((parent_step_run_id IS NULL) = (role IS NULL)),
  CHECK (parent_step_run_id IS NULL OR ((status='completed') = (verdict IS NOT NULL))),
  CHECK (verdict IS NULL OR parent_step_run_id IS NOT NULL)
);
CREATE INDEX ix_steprun_run ON workflow_step_runs(workflow_run_id, status);
CREATE UNIQUE INDEX ux_live_reviewer ON workflow_step_runs(workflow_run_id, parent_step_run_id, role)
  WHERE status IN ('pending','running');

CREATE TABLE blockers (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','resolved','cancelled')),
  question TEXT,
  options_json TEXT,
  answer TEXT,
  choice TEXT,
  answered_by TEXT,
  answered_at TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(answered_by) REFERENCES agents(id) ON DELETE RESTRICT,
  CHECK ((blocker_type='human_gate') = (question IS NOT NULL AND options_json IS NOT NULL)),
  CHECK (blocker_type <> 'human_gate' OR status <> 'resolved' OR (answer IS NOT NULL OR choice IS NOT NULL))
);
CREATE INDEX ix_blockers_open ON blockers(work_item_id) WHERE status='open';

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  work_item_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation TEXT,
  confidence INTEGER CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 100)),
  decision TEXT,
  category TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','recommended','decided','cancelled')),
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY(work_item_id) REFERENCES work_items(id) ON DELETE RESTRICT,
  FOREIGN KEY(artifact_id) REFERENCES artifacts(id) ON DELETE RESTRICT,
  CHECK ((status='decided') = (decided_at IS NOT NULL))
);
CREATE INDEX ix_decisions_category ON decisions(category);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_policies_scope ON policies(scope_type, scope_id);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_events_entity ON events(entity_type, entity_id, created_at);
