import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from './Skeleton';

describe('Skeleton', () => {
  it('is aria-hidden and renders `count` rows', () => {
    const { container } = render(<Skeleton count={3} />);
    const root = container.querySelector('[role="presentation"]');
    expect(root).toHaveAttribute('aria-hidden', 'true');
    expect(root?.children.length).toBe(3);
  });
});
