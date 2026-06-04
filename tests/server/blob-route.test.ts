import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { serveBlob } from '../../src/server/files.js';

let root: string;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apm-blobroute-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fakeRes() {
  return { statusCode: 0, headers: {} as Record<string, string>, body: undefined as Buffer | undefined,
    writeHead(code: number, h?: Record<string, string>) { this.statusCode = code; if (h) Object.assign(this.headers, h); },
    end(b?: Buffer) { this.body = b; } };
}

describe('serveBlob', () => {
  it('serves a content-addressed blob with immutable cache + ETag', () => {
    const sha = createHash('sha256').update(PNG).digest('hex');
    mkdirSync(join(root, '.apm', 'blobs', sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(root, '.apm', 'blobs', sha.slice(0, 2), `${sha}.png`), PNG);
    const res: any = fakeRes();
    serveBlob(root, sha, res, {});
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['ETag']).toBe(`"${sha}"`);
    expect(res.body?.equals(PNG)).toBe(true);
  });
  it('404s a non-hex or missing sha (no traversal)', () => {
    const res: any = fakeRes();
    serveBlob(root, '../../etc/passwd', res, {});
    expect(res.statusCode).toBe(404);
    const res2: any = fakeRes();
    serveBlob(root, 'a'.repeat(64), res2, {});
    expect(res2.statusCode).toBe(404); // valid hex but no file
  });
});
