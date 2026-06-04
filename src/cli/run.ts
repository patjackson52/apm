import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Clock } from '../domain/clock.js';
import { systemClock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';
import type { Storage } from '../storage/storage.js';
import { ApmError, exitFor } from '../domain/errors.js';
import { ok, fail, buildMeta } from '../format/envelope.js';
import { render, type OutputFormat } from '../format/render.js';

export interface RunDeps {
  dir?: string;
  clock?: Clock;
  format?: OutputFormat;
  out?: (line: string) => void;
}

export interface Ctx { storage: Storage; clock: Clock; }
export interface CmdResult { data: unknown; session?: string; meta?: Record<string, unknown>; }

export function resolveFormat(explicit: string | undefined, env: Record<string, string | undefined>, isTty: boolean): OutputFormat {
  const pick = (explicit ?? env.APM_FORMAT ?? (isTty ? 'human' : 'json')) as OutputFormat;
  return (['human', 'json', 'yaml', 'agent'] as const).includes(pick) ? pick : 'json';
}

/** Walk up from `start` to find a `.apm/apm.db`. Throws E_NOT_FOUND if none. */
export function findProjectDb(start: string): string {
  let cur = resolve(start);
  for (;;) {
    const candidate = join(cur, '.apm', 'apm.db');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cur);
    if (parent === cur) throw new ApmError('E_NOT_FOUND', 'no APM project found (run `apm init`)');
    cur = parent;
  }
}

/** The project root (dir holding .apm) for blob IO, mirroring runCommand's db resolution. */
export function resolveProjectRoot(dir?: string): string {
  if (dir != null) {
    const candidate = join(resolve(dir), '.apm', 'apm.db');
    if (!existsSync(candidate)) throw new ApmError('E_NOT_FOUND', 'no APM project found (run `apm init`)');
    return resolve(dir);
  }
  return dirname(dirname(findProjectDb(process.cwd())));
}

export function runCommand(deps: RunDeps, command: string, fn: (ctx: Ctx) => CmdResult): number {
  const clock = deps.clock ?? systemClock;
  const out = deps.out ?? ((s: string) => process.stdout.write(s + '\n'));
  const format = deps.format ?? 'json';
  let storage: Storage | undefined;
  try {
    // When --dir is explicit, look only in that exact directory (no walk-up).
    const dbPath = deps.dir != null
      ? (() => {
          const candidate = join(resolve(deps.dir), '.apm', 'apm.db');
          if (!existsSync(candidate)) throw new ApmError('E_NOT_FOUND', 'no APM project found (run `apm init`)');
          return candidate;
        })()
      : findProjectDb(process.cwd());
    storage = new SqliteStorage(dbPath, clock);
    const result = fn({ storage, clock });
    const meta = buildMeta(command, clock, result.session);
    if (result.meta) Object.assign(meta, result.meta);
    out(render(format, ok(result.data, meta)));
    return 0;
  } catch (err) {
    const apm = err instanceof ApmError ? err : new ApmError('E_INTERNAL', String((err as Error)?.message ?? err));
    out(render(format, fail(apm, buildMeta(command, clock))));
    return exitFor(apm);
  } finally {
    storage?.close();
  }
}
