import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EditViaCli } from './EditViaCli';

describe('EditViaCli', () => {
  it('renders an enabled Edit button (not a disabled stub)', () => {
    render(<EditViaCli name="implementation" />);
    const btn = screen.getByTitle('Editing is available via the apm CLI');
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('when open, shows the apm prompt revise command and the future-runs scope warning', () => {
    const { container } = render(<EditViaCli name="implementation" body="hello" open />);
    expect(container.textContent).toContain('apm prompt revise');
    expect(container.textContent).toContain('--body-file ./implementation.md');
    expect(container.textContent).toContain('Edits the shared prompt for future runs.');
    expect(container.textContent).toContain(
      'This run already snapshotted its dispatched text — that snapshot does not change.',
    );
  });

  it('is closed by default (no command shown)', () => {
    const { container } = render(<EditViaCli name="implementation" />);
    expect(container.textContent).not.toContain('apm prompt revise');
  });
});
