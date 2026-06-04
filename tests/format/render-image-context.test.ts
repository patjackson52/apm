// tests/format/render-image-context.test.ts
import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';

const envelope = {
  ok: true,
  data: {
    status: 'dispatched',
    work_item: 'WI-1',
    step: { id: 'design', type: 'agent_execution' },
    allowed_action: 'design from the mockup',
    required_context: [
      { id: 'IMG-7', version: 1, type: 'image', title: 'mockup', one_line: 'mockup', path: '.apm/blobs/ab/deadbeef.png', alt: 'login mockup', blob: 'deadbeef' },
      { id: 'ART-3', version: 2, type: 'spec', title: 'Tech Spec', one_line: 'the spec' },
    ],
    required_captures: [],
    do_not: [],
    when_done: [],
  },
  error: null,
  meta: {},
};

describe('agent format REQUIRED_CONTEXT images', () => {
  it('renders an image entry with [image] tag + path/alt sub-lines, text entry unchanged', () => {
    const out = render('agent', envelope as any);
    expect(out).toContain('IMG-7@1 "mockup" [image]');
    expect(out).toContain('  path: .apm/blobs/ab/deadbeef.png');
    expect(out).toContain('  alt:  login mockup');
    // non-image entry keeps the dash form
    expect(out).toContain('ART-3@2 "Tech Spec" — the spec');
  });
});
