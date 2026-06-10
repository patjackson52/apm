import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComposedPrompt } from './ComposedPrompt';
import { makeDispatch } from './fixtures';

describe('ComposedPrompt', () => {
  it('renders the stored prompt body text in the layered view', () => {
    render(<ComposedPrompt dispatch={makeDispatch()} />);
    expect(screen.getByText(/Implement the feature described in the spec/)).toBeTruthy();
    expect(screen.getByText('Stored prompt body')).toBeTruthy();
  });

  it('renders an injected <script> in a scaffold value as inert literal text (no sink)', () => {
    const evil = '<script>alert(1)</script>';
    const { container } = render(
      <ComposedPrompt
        dispatch={makeDispatch({
          scaffold: {
            allowed_action: `Do the thing ${evil}`,
            required_context: [],
            do_not: [],
            when_done: [],
          },
        })}
      />,
    );
    // No live <script> element was created.
    expect(container.querySelector('script')).toBeNull();
    // The literal string is present as text content.
    expect(container.textContent).toContain(evil);
  });

  it('renders an injected <script> in the prompt body as inert text (no sink)', () => {
    const evil = '<script>alert(2)</script>';
    const { container } = render(
      <ComposedPrompt dispatch={makeDispatch({ body: `body ${evil}` })} />,
    );
    expect(container.querySelector('script')).toBeNull();
  });

  it('defaultView="raw" shows the verbatim raw snapshot', () => {
    const d = makeDispatch();
    const { container } = render(<ComposedPrompt dispatch={d} defaultView="raw" />);
    const pre = container.querySelector('pre.raw-snap');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(d.raw);
  });
});
