import { describe, it, expect } from 'vitest';
import { parseWorkflow, validateWorkflow, firstStep, nextStepId, stepById } from '../../src/domain/workflow.js';

const YAML = `
id: demo
version: 1
name: Demo
applies_to: [feature, task]
status: active
steps:
  - id: brainstorm
    type: agent_prompt
    outputs: [{ artifact_type: spec }]
    next: [design]
  - id: design
    type: agent_prompt
    requires: { artifacts: [spec] }
    outputs: [{ artifact_type: design }]
    next: [complete]
  - id: complete
    type: terminal
`;

describe('workflow dsl', () => {
  it('parses a definition', () => {
    const def = parseWorkflow(YAML);
    expect(def.id).toBe('demo'); expect(def.steps).toHaveLength(3);
    expect(def.steps[0].outputs?.[0].artifact_type).toBe('spec');
  });

  it('validates a good definition', () => {
    expect(() => validateWorkflow(parseWorkflow(YAML))).not.toThrow();
  });

  it('rejects a branching next (V1 is linear)', () => {
    const bad = parseWorkflow(YAML.replace('next: [design]', 'next: [design, complete]'));
    expect(() => validateWorkflow(bad)).toThrowError(/linear|single|branch/i);
  });

  it('rejects an unknown step type', () => {
    const bad = parseWorkflow(YAML.replace('type: terminal', 'type: bogus'));
    expect(() => validateWorkflow(bad)).toThrowError(/step type/i);
  });

  it('rejects a next pointing at a missing step', () => {
    const bad = parseWorkflow(YAML.replace('next: [complete]', 'next: [nope]'));
    expect(() => validateWorkflow(bad)).toThrowError(/unknown step|nope/i);
  });

  it('requires reviewers on a review_gate', () => {
    const rg = parseWorkflow(`
id: d
version: 1
name: D
applies_to: [feature]
status: active
steps:
  - id: r
    type: review_gate
    next: [done]
  - id: done
    type: terminal
`);
    expect(() => validateWorkflow(rg)).toThrowError(/reviewer/i);
  });

  it('navigates first/next/by-id', () => {
    const def = parseWorkflow(YAML);
    expect(firstStep(def).id).toBe('brainstorm');
    expect(nextStepId(def, 'brainstorm')).toBe('design');
    expect(nextStepId(def, 'complete')).toBeNull();
    expect(stepById(def, 'design')?.type).toBe('agent_prompt');
  });
});
