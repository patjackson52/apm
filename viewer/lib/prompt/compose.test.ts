import { describe, it, expect } from 'vitest';
import { composeMarkdown } from './compose';
import { makeDispatch } from '@/components/prompt/fixtures';

describe('composeMarkdown', () => {
  it('renders each contract section as a ## heading with the body fenced', () => {
    const md = composeMarkdown(makeDispatch());
    expect(md).toContain('## WORK_ITEM');
    expect(md).toContain('## CURRENT_STEP');
    expect(md).toContain('## PROMPT — implementation@2');
    expect(md).toContain('## ALLOWED_ACTION');
    expect(md).toContain('## REQUIRED_CONTEXT');
    expect(md).toContain('## DO_NOT');
    expect(md).toContain('## WHEN_DONE');
    // body is fenced
    expect(md).toContain('```\nImplement the feature described in the spec.');
    // required_context lines rendered as plain bullet strings
    expect(md).toContain('- ART-9 "My Spec" — the approved spec');
  });

  it('omits empty scaffold sections', () => {
    const md = composeMarkdown(
      makeDispatch({
        scaffold: { allowed_action: null, required_context: [], do_not: [], when_done: [] },
      }),
    );
    expect(md).not.toContain('## ALLOWED_ACTION');
    expect(md).not.toContain('## DO_NOT');
  });
});
