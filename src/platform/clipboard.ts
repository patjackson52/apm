import { execFileSync } from 'node:child_process';
import { ApmError } from '../domain/errors.js';

export interface Invocation { cmd: string; args: string[] }

/** osascript to PUT an image file onto the macOS clipboard. */
export function copyImageArgs(platform: string, absPath: string): Invocation {
  if (platform !== 'darwin') throw new ApmError('E_UNSUPPORTED', `clipboard copy unsupported on ${platform}`);
  return { cmd: 'osascript', args: ['-e', `set the clipboard to (read (POSIX file "${absPath}") as «class PNGf»)`] };
}

/** Open a file in the OS default viewer. */
export function openArgs(platform: string, absPath: string): Invocation {
  if (platform === 'darwin') return { cmd: 'open', args: [absPath] };
  if (platform === 'linux') return { cmd: 'xdg-open', args: [absPath] };
  throw new ApmError('E_UNSUPPORTED', `open unsupported on ${platform}`);
}

/** osascript that writes the clipboard image to a destination path. Returns the script string. */
export function pasteImageScript(platform: string): string {
  if (platform !== 'darwin') throw new ApmError('E_UNSUPPORTED', `clipboard paste unsupported on ${platform}`);
  return 'set png to the clipboard as «class PNGf»';
}

/** Thin exec seam (not unit-tested). */
export function run(inv: Invocation): void {
  execFileSync(inv.cmd, inv.args, { stdio: 'ignore' });
}
