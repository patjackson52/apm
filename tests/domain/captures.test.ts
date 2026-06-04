// tests/domain/captures.test.ts
import { describe, it, expect } from 'vitest';
import { unmetCaptures } from '../../src/domain/captures.js';
import type { CaptureSpec } from '../../src/domain/workflow.js';

const spec = (o: Partial<CaptureSpec>): CaptureSpec => ({ name: 'c', kind: 'screenshot', ...o });

describe('unmetCaptures', () => {
  it('returns [] when an image satisfies kind', () => {
    expect(unmetCaptures([spec({})], [{ kind: 'screenshot', capture: null }])).toEqual([]);
  });
  it('flags unmet when no image matches kind', () => {
    expect(unmetCaptures([spec({ name: 'x', kind: 'diagram' })], [{ kind: 'screenshot', capture: null }])).toEqual(['x']);
  });
  it('matches on route when specified', () => {
    const s = [spec({ name: 'r', route: '/login' })];
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { route: '/home' } }])).toEqual(['r']);
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { route: '/login' } }])).toEqual([]);
  });
  it('matches on viewport when specified', () => {
    const s = [spec({ name: 'v', viewport: { w: 1280, h: 800 } })];
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { viewport: { w: 375, h: 812 } } }])).toEqual(['v']);
    expect(unmetCaptures(s, [{ kind: 'screenshot', capture: { viewport: { w: 1280, h: 800 } } }])).toEqual([]);
  });
});
