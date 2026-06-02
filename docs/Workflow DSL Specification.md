# 5. Workflow DSL Specification

## Design Goal

Workflows should be declarative, versioned, and easy for humans and agents to inspect.

## Workflow Example

```
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

```
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

```
next:
  - planning
```

Later versions may support conditional transitions:

```
next:
  - when: confidence >= 90
    step: implementation
  - when: confidence < 90
    step: human_gate
```

## Policies

Policies can override autonomy.

```
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

```
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