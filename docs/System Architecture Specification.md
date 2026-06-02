# 2. System Architecture Specification

## Architecture Principle

APM is a durable project execution graph.

```text
Work Items organize work.
Workflows govern work.
Dependencies constrain work.
Blockers pause work.
Leases protect work.
Artifacts preserve knowledge.
Policies control autonomy.
Sessions optimize context.
```

## Core Primitives

### WorkItem

General recursive object.

Types:

```text
project
goal
milestone
feature
task
subtask
bug
research
human_gate
maintenance
```

Work items may have parents, children, dependencies, blockers, artifacts, workflows, leases, and sessions.

### WorkflowDefinition

Versioned reusable workflow template.

Immutable once used.

### WorkflowRun

Instance of a workflow attached to a work item.

A work item can have multiple workflow runs.

### PromptDefinition

Reusable prompt template referenced by workflow steps.

### Artifact

APM-owned document or data object.

Types:

```text
spec
adr
decision
design
plan
review
handoff
work_log
status_report
```

Artifacts are versioned and immutable.

### Spec

A versioned artifact.

States:

```text
draft
review
approved
superseded
archived
```

Agents may revise specs by creating new versions.

### Decision

Structured decision record.

Fields:

```text
question
options
recommendation
confidence
decision
decision_maker
status
```

Not every decision becomes an ADR.

### ADR

Artifact created from significant decisions.

ADR policy determines when ADRs are auto-created.

### Lease

Execution lock on a work item.

Leases apply to work items, not individual workflow steps.

### Agent

Named actor.

Examples:

```text
claude-code
codex
security-reviewer
architecture-reviewer
human:patrick
```

### Session

Execution context for an agent or human interaction.

A session may execute multiple workflow steps.

### Blocker

Current impediment.

Examples:

```text
dependency incomplete
human gate unresolved
external system failure
missing credential
review disagreement
```

### Policy

Rules controlling autonomy.

Examples:

```yaml
auto_create_work_items: true
auto_create_adrs: true
auto_accept_recommendations:
  confidence_threshold: 90
human_gate_required:
  - budget
  - security_exception
  - product_direction
max_work_item_depth: 5
```

## Work Item Status

```text
draft      created but not ready
ready      eligible to run
active     currently leased
blocked    cannot proceed
completed  required workflows complete
cancelled  intentionally abandoned
```

## Estimate Scale

Use T-shirt sizing.

```text
XS  <= 30 min
S   half day
M   1 day
L   2-3 days
XL  should split
```

## Autonomy Loop

```text
runner wakes
  ↓
apm next
  ↓
agent performs allowed action
  ↓
agent records artifact/status
  ↓
apm advances workflow
  ↓
repeat until complete/blocked/no work
```

APM provides correctness. Claude Code `/loop`, cron, shell daemons, or schedulers provide repetition.
