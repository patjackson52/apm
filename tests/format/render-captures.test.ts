import { describe, it, expect } from 'vitest';
import { render } from '../../src/format/render.js';

const envelope = {
  ok: true,
  data: {
    status: 'dispatched',
    work_item: 'WI-1',
    step: { id: 'shoot', type: 'agent_execution' },
    allowed_action: 'capture screenshots',
    required_context: [],
    required_captures: [
      { name: 'home-shot', kind: 'screenshot', route: '/home', viewport: { w: 1280, h: 800 }, prompt: 'capture-home' },
    ],
    do_not: [],
    when_done: [],
  },
  error: null,
  meta: {},
};

describe('agent format REQUIRED_CAPTURES', () => {
  it('renders a REQUIRED_CAPTURES block with matchers + recipe', () => {
    const out = render('agent', envelope as any);
    expect(out).toContain('REQUIRED_CAPTURES:');
    expect(out).toContain('home-shot  kind=screenshot  route=/home  viewport=1280x800  recipe=capture-home');
  });
});
