import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { putBlob, blobAbsPath, blobRelPath } from '../../src/storage/blobstore.js';

// 1x1 transparent PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG = Buffer.from(PNG_B64, 'base64');

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apm-bs-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('putBlob', () => {
  it('writes content-addressed bytes and returns metadata', () => {
    const m = putBlob(root, PNG);
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(m.mime).toBe('image/png');
    expect(m.ext).toBe('png');
    expect(m.byte_size).toBe(PNG.length);
    expect(m.width).toBe(1);
    expect(m.height).toBe(1);
    const abs = blobAbsPath(root, m.sha256, m.ext);
    expect(existsSync(abs)).toBe(true);
    expect(readFileSync(abs).equals(PNG)).toBe(true);
    expect(blobRelPath(m.sha256, m.ext)).toBe(`.apm/blobs/${m.sha256.slice(0, 2)}/${m.sha256}.png`);
  });

  it('dedups identical bytes to the same sha + path (idempotent)', () => {
    const a = putBlob(root, PNG);
    const b = putBlob(root, PNG);
    expect(a.sha256).toBe(b.sha256);
  });

  it('rejects non-image bytes', () => {
    expect(() => putBlob(root, Buffer.from('not an image'))).toThrow();
  });
});
