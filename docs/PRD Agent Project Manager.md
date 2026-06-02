
# 1. PRD — APM: Agent Project Manager

## Product Summary

APM is a CLI-first project state and workflow system for autonomous AI development. It is not an AI orchestrator, prompter, coding agent, or memory system. It provides durable, deterministic project execution state for humans and agents.

## Problem

AI agents lose track of project state across sessions, context windows, restarts, and multi-agent workflows. Existing systems rely on markdown plans, chat history, or human-centric PM tools.

## Goal

Create a local-first CLI tool that agents and humans use as the source of truth for:

- work items
    
- workflows
    
- specs
    
- ADRs
    
- decisions
    
- blockers
    
- leases
    
- sessions
    
- artifacts
    
- status
    

## Core Product Thesis

APM answers:

> What work exists, what state is it in, and what is the agent allowed to do next?

## Primary Users

- Human product owner / engineer
    
- Claude Code / coding agents
    
- Review agents
    
- Future human UI users
    

## MVP Scope

CLI only.

Includes:

- durable storage
    
- work item graph
    
- workflows
    
- prompts
    
- artifacts
    
- specs
    
- ADRs
    
- decisions
    
- blockers
    
- dependencies
    
- leases
    
- sessions
    
- `apm next`
    
- machine-readable output
    

Excludes:

- web UI
    
- hosted sync
    
- authentication
    
- multi-user permissions
    
- full external PM sync
    
- built-in AI orchestration
    

## Long-Term Vision

Future clients:

- web UI
    
- MCP server
    
- GitHub/Linear/Plane/Jira integrations
    
- dashboards
    
- human gate inbox
    
- artifact viewer
    
- workflow editor
    

## Success Criteria

An agent can repeatedly run:

```bash
apm next --agent claude --session current --format agent
```

and safely continue project work across days, sessions, and context resets without losing project state.