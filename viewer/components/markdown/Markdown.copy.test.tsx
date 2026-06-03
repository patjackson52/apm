import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Markdown } from './Markdown';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
    })),
  },
}));

let writeText: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText, write } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Markdown copy affordances (WI-30)', () => {
  it('doc-level Copy markdown copies the raw body', async () => {
    render(<Markdown body={'# Title\n\nhello'} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy markdown' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('# Title\n\nhello'));
  });

  it('section copy copies that heading section source', async () => {
    render(<Markdown body={'# Alpha\n\nbody\n\n# Beta\n\nmore'} docCopy={false} />);
    const btns = screen.getAllByRole('button', { name: 'Copy section' });
    fireEvent.click(btns[0]!);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('# Alpha');
    expect(writeText.mock.calls[0]![0]).not.toContain('# Beta');
  });

  it('code-block copy copies the raw code', async () => {
    render(<Markdown body={'```js\nconst x = 1;\n```'} docCopy={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0]![0]).toContain('const x = 1;');
  });

  it('table copy offers markdown and CSV', async () => {
    render(<Markdown body={'| a | b |\n| - | - |\n| 1 | 2 |'} docCopy={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy as markdown' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const out = writeText.mock.calls[0]![0];
    expect(out).toContain('| a | b |');
    expect(out).toContain('| 1 | 2 |');
  });

  it('Cmd+Shift+C copies the doc', async () => {
    render(<Markdown body={'shortcut body'} docCopy={false} />);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyC', metaKey: true, shiftKey: true, bubbles: true }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('shortcut body'));
  });

  it('mermaid exposes Copy as image when image clipboard is supported', async () => {
    class FakeClipboardItem { constructor(public p: Record<string, Blob>) {} }
    vi.stubGlobal('ClipboardItem', FakeClipboardItem);
    class FakeImage {
      width = 10; height = 10;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    vi.stubGlobal('Image', FakeImage);
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: () => ({ drawImage: vi.fn() }),
          toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['PNG'], { type: 'image/png' })),
        } as unknown as HTMLCanvasElement;
      }
      return realCreate(tag);
    }) as typeof document.createElement);

    render(<Markdown body={'```mermaid\ngraph TD; A-->B\n```'} docCopy={false} />);
    const imgBtn = await screen.findByRole('button', { name: 'Copy as image' });
    fireEvent.click(imgBtn);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
  });
});
