import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveBlob } from './resolveBlob';

let root: string;
const SHA = 'a'.repeat(64);
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'vw-blob-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('resolveBlob', () => {
  it('resolves a valid sha to its on-disk blob + content type', async () => {
    mkdirSync(join(root, '.apm', 'blobs', 'aa'), { recursive: true });
    writeFileSync(join(root, '.apm', 'blobs', 'aa', `${SHA}.png`), Buffer.from('x'));
    const r = await resolveBlob(root, SHA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.contentType).toBe('image/png');
  });
  it('rejects a non-hex sha', async () => {
    expect((await resolveBlob(root, '../etc')).ok).toBe(false);
  });
});
