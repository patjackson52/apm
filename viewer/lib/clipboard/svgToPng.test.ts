import { describe, it, expect, vi, afterEach } from 'vitest';
import { svgToPng } from './svgToPng';

let lastSrc = '';

class FakeImage {
  width = 120;
  height = 80;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _fail: boolean;
  constructor() { this._fail = false; }
  set src(v: string) {
    lastSrc = v;
    this._fail = v.includes('FAILME');
    queueMicrotask(() => (this._fail ? this.onerror?.() : this.onload?.()));
  }
}

afterEach(() => vi.restoreAllMocks());

function stubCanvas() {
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(['PNG'], { type: 'image/png' })),
      } as unknown as HTMLCanvasElement;
    }
    return document.createElement(tag);
  }) as typeof document.createElement);
}

describe('svgToPng', () => {
  it('sanitizes the SVG before rasterizing and returns a png Blob', async () => {
    vi.stubGlobal('Image', FakeImage);
    stubCanvas();
    const dirty = '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><script>alert(1)</script></foreignObject><rect/></svg>';
    const blob = await svgToPng(dirty);
    expect(blob.type).toBe('image/png');
    const decoded = decodeURIComponent(lastSrc.replace('data:image/svg+xml;charset=utf-8,', ''));
    expect(decoded).not.toMatch(/foreignObject/i);
    expect(decoded).not.toMatch(/<script/i);
    expect(decoded).toMatch(/<rect/i);
    vi.unstubAllGlobals();
  });

  it('rejects when the image fails to load (no partial copy)', async () => {
    vi.stubGlobal('Image', FakeImage);
    stubCanvas();
    await expect(svgToPng('<svg>FAILME</svg>')).rejects.toThrow(/load/);
    vi.unstubAllGlobals();
  });
});
