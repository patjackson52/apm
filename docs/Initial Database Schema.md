# 3. Initial Database Schema

Reference storage: SQLite.

Storage should be abstracted behind a provider interface.

```
CREATE TABLE work_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL,
  priority INTEGER DEFAULT 0,
  estimate TEXT,
  parent_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(parent_id) REFERENCES work_items(id)
);

CREATE TABLE work_item_links (
  id TEXT PRIMARY KEY,
  source_work_item_id TEXT NOT NULL,
  target_work_item_id TEXT NOT NULL,
  link_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  capabilities TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  context_summary TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT,
  ended_at TEXT
);

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  session_id TEXT,
  status TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT
);

CREATE TABLE workflow_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE workflow_runs (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  workflow_definition_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE workflow_step_runs (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  output_artifact_id TEXT,
  failure_reason TEXT
);

CREATE TABLE prompt_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  body TEXT,
  metadata_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  supersedes_artifact_id TEXT
);

CREATE TABLE work_item_artifacts (
  work_item_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  PRIMARY KEY(work_item_id, artifact_id)
);

CREATE TABLE blockers (
  id TEXT PRIMARY KEY,
  work_item_id TEXT NOT NULL,
  blocker_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  work_item_id TEXT,
  question TEXT NOT NULL,
  options_json TEXT NOT NULL,
  recommendation TEXT,
  confidence INTEGER,
  decision TEXT,
  status TEXT NOT NULL,
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE policies (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
```