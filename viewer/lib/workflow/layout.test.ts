import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layout';

const steps = [
  { id: 'a', type: 'agent_prompt' },
  { id: 'b', type: 'review_gate' },
  { id: 'c', type: 'terminal' },
];
const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }];

describe('layoutGraph', () => {
  it('ranks a linear chain by increasing y', () => {
    const r = layoutGraph(steps, edges);
    const y = (id: string) => r.nodes.find((n) => n.id === id)!.y;
    expect(y('a')).toBeLessThan(y('b'));
    expect(y('b')).toBeLessThan(y('c'));
  });

  it('is deterministic across calls', () => {
    expect(layoutGraph(steps, edges)).toEqual(layoutGraph(steps, edges));
  });

  it('places stray (unreferenced) nodes after the chain in source order', () => {
    const r = layoutGraph([...steps, { id: 'z', type: 'manual' }], edges);
    expect(r.nodes.find((n) => n.id === 'z')!.y).toBeGreaterThan(r.nodes.find((n) => n.id === 'c')!.y);
  });
});
