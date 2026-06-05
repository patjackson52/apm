# 4. CLI Command Specification

## Output Formats

Every read command should support:

```bash
--format human
--format json
--format yaml
--format agent
```

Default for humans:

```bash
--format human
```

Default for agent scripts:

```bash
--format json
```

## Project / Work Items

```bash
apm init

apm work create \
  --type milestone \
  --title "Offline support" \
  --description "Enable offline usage and sync"

apm work list
apm work show WI-123
apm work update WI-123 --status ready
apm work link WI-123 --depends-on WI-45
apm work children WI-123
```

## Agent Loop

```bash
apm next \
  --agent claude-code \
  --session current \
  --capabilities planning,coding,review \
  --match any \
  --format agent
```

`--match` values:

```text
any
all
```

## Leases

```bash
apm lease acquire WI-123 --agent claude-code --session S-1 --ttl 30m
apm lease heartbeat LEASE-1
apm lease release LEASE-1
apm lease expire-stale
```

## Sessions

```bash
apm session start --agent claude-code
apm session show S-1
apm session summarize S-1 --body "Summary..."
apm session end S-1
```

## Workflows

```bash
apm workflow list
apm workflow show feature_delivery_v1
apm workflow attach WI-123 --workflow feature_delivery_v1
apm workflow runs WI-123
apm step complete WR-1 design --artifact ART-9
apm step fail WR-1 implementation --reason "Tests failing"
```

## Artifacts

```bash
apm artifact create \
  --work-item WI-123 \
  --type spec \
  --title "Offline sync spec" \
  --body-file spec.md

apm artifact show ART-1
apm artifact revise ART-1 --body-file spec-v2.md
apm artifact list --work-item WI-123
```

## Decisions / ADRs

```bash
apm decision create \
  --work-item WI-123 \
  --question "Use SQLite or Postgres?" \
  --options "SQLite,Postgres" \
  --recommendation "SQLite" \
  --confidence 94

apm decision accept DEC-1 --choice "SQLite"
apm adr create-from-decision DEC-1
apm adr list
apm adr show ADR-1
```

## Blockers / Human Gates

```bash
apm blocker create WI-123 \
  --type human_gate \
  --reason "Need product decision on conflict resolution"

apm blocker resolve BLK-1 --resolution "Use last-write-wins for MVP"

apm gates list
apm gate answer HG-1 --choice "Option B" --note "Prefer simpler MVP"
```

## Agent Prompt Contract

`apm next --format agent` returns the dispatched step's contract. `CURRENT_STEP`
includes the step type in parentheses. The optional `PROMPT` block appears only
when the workflow step declares a `prompt_id`; it names a stored prompt — fetch its
body with `apm prompt show <name>`. `REQUIRED_CONTEXT` lines are
`<ID>@<version> "<title>" — <one_line>` (image refs render as `[image]` with
`path:`/`alt:` sub-lines). Sections with no content are omitted.

```text
WORK_ITEM:
WI-123

CURRENT_STEP:
design (agent_prompt)

PROMPT:
design_solution_v1

ALLOWED_ACTION:
Produce the design artifact(s) for "design".

REQUIRED_CONTEXT:
SPEC-1@2 "Auth spec" — the approved spec

DO_NOT:
- write implementation code
- open a PR

WHEN_DONE:
apm step complete WR-1 design --artifact-type design --body-file <path> --agent <agent>
```

On a real dispatch (`--acquire`), the rendered contract above is also persisted on
the step run as `dispatch_prompt` (an event `workflow_run.dispatched` is appended),
so it is retrievable for audit and shown in the viewer UI. A preview `apm next`
without `--acquire` does not mutate.

# 5. Workflow DSL Specification

## Design Goal

Workflows should be declarative, versioned, and easy for humans and agents to inspect.

## Workflow Example

```yaml
id: feature_delivery
version: 1
name: Feature Delivery Workflow
applies_to:
  - feature
  - task
status: active

session_policy:
  default: prefer_continue
  same_session_preferred:
    - brainstorm
    - design
    - planning
    - implementation
  fresh_session_required:
    - independent_review
    - security_review

steps:
  - id: brainstorm
    type: agent_prompt
    prompt_id: brainstorm_feature_v1
    outputs:
      - artifact_type: decision
      - artifact_type: spec
    next:
      - design

  - id: design
    type: agent_prompt
    prompt_id: design_solution_v1
    requires:
      artifacts:
        - spec
    outputs:
      - artifact_type: design
    next:
      - design_review

  - id: design_review
    type: review_gate
    reviewers:
      - architecture
      - security
      - simplicity
    pass_policy: all_required
    next:
      - planning

  - id: planning
    type: agent_prompt
    prompt_id: implementation_plan_v1
    requires:
      artifacts:
        - design
    outputs:
      - artifact_type: plan
    may_create_work_items: true
    next:
      - implementation

  - id: implementation
    type: agent_execution
    requires:
      artifacts:
        - plan
    outputs:
      - artifact_type: work_log
    next:
      - pr_create

  - id: pr_create
    type: integration
    action: github_create_pr
    next:
      - pr_monitor

  - id: pr_monitor
    type: integration_loop
    action: github_monitor_pr
    next:
      - merge

  - id: merge
    type: integration
    action: github_merge_pr
    next:
      - complete

  - id: complete
    type: terminal
```

## Step Types

```text
agent_prompt
agent_execution
review_gate
human_gate
decision
decompose
integration
integration_loop
manual
terminal
```

## Transition Model

Use simple state-machine transitions.

```yaml
next:
  - planning
```

Later versions may support conditional transitions:

```yaml
next:
  - when: confidence >= 90
    step: implementation
  - when: confidence < 90
    step: human_gate
```

## Policies

Policies can override autonomy.

```yaml
policies:
  auto_accept_recommendations:
    enabled: true
    confidence_threshold: 90

  auto_create_work_items: true

  adr_policy:
    auto_create: true
    categories:
      - architecture
      - storage
      - platform
      - workflow
    confidence_threshold: 85
```

## Built-In MVP Workflow

Initial workflow should be:

```text
brainstorm
→ decision
→ spec
→ design
→ design_review
→ planning
→ implementation
→ pr_create
→ pr_monitor
→ merge
→ complete
```

This mirrors the Superpowers flow while allowing autonomous continuation through `apm next`.