import { describe, it, expect } from 'vitest';
import { copyImageArgs, openArgs, pasteImageScript } from '../../src/platform/clipboard.js';

describe('clipboard arg builders', () => {
  it('builds a macOS copy-to-clipboard osascript invocation', () => {
    const { cmd, args } = copyImageArgs('darwin', '/tmp/x.png');
    expect(cmd).toBe('osascript');
    expect(args.join(' ')).toContain('set the clipboard to');
    expect(args.join(' ')).toContain('/tmp/x.png');
  });
  it('builds an open invocation per platform', () => {
    expect(openArgs('darwin', '/tmp/x.png').cmd).toBe('open');
    expect(openArgs('linux', '/tmp/x.png').cmd).toBe('xdg-open');
  });
  it('throws E_UNSUPPORTED on an unknown platform', () => {
    expect(() => copyImageArgs('win32', '/tmp/x.png')).toThrow(/unsupported/i);
    expect(() => pasteImageScript('win32')).toThrow(/unsupported/i);
  });
});
