import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunBanner } from './RunBanner';
import { RunLegend } from './RunLegend';

describe('RunBanner', () => {
  it('shows for paused/cancelled, nothing for running', () => {
    const { container, rerender } = render(<RunBanner status="paused" />);
    expect(screen.getByText('Run paused')).toBeTruthy();
    rerender(<RunBanner status="running" />);
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
describe('RunLegend', () => {
  it('lists the 5 step-run statuses', () => {
    render(<RunLegend />);
    for (const l of ['Pending', 'Running', 'Completed', 'Failed', 'Skipped']) {
      expect(screen.getByText(l)).toBeTruthy();
    }
  });
});
