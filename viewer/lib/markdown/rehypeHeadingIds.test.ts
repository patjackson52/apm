import { describe, it, expect } from 'vitest';
import { rehypeHeadingIds } from './rehypeHeadingIds';

describe('rehypeHeadingIds', () => {
  it('sets a bare-slug id on heading nodes', () => {
    const tree = {
      type: 'root',
      children: [
        { type: 'element', tagName: 'h2', properties: {}, children: [{ type: 'text', value: 'Hello World' }] },
        { type: 'element', tagName: 'p', properties: {}, children: [{ type: 'text', value: 'body' }] },
      ],
    };
    rehypeHeadingIds()(tree as never);
    expect((tree.children[0] as { properties: { id?: string } }).properties.id).toBe('hello-world');
    expect((tree.children[1] as { properties: { id?: string } }).properties.id).toBeUndefined();
  });
});
