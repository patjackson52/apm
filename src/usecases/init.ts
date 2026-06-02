import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Clock } from '../domain/clock.js';
import type { Storage } from '../storage/storage.js';
import { SqliteStorage } from '../storage/sqlite.js';
import { seedBuiltins } from './seed.js';

const DEFAULT_CONFIG = `# APM tool configuration (not policies — those live in the DB).
capabilities:
  - planning
  - design
  - coding
  - review
  - security
`;

export interface InitResult {
  created: boolean;
  dbPath: string;
}

/** Create .apm/ with a migrated db and a default config. Idempotent. */
export function initProject(
  dir: string,
  clock: Clock,
  createStorage: (path: string, clock: Clock) => Storage = (path, c) => new SqliteStorage(path, c),
): InitResult {
  const apmDir = join(resolve(dir), '.apm');
  const dbPath = join(apmDir, 'apm.db');
  const alreadyInitialized = existsSync(dbPath);

  mkdirSync(apmDir, { recursive: true });

  const storage = createStorage(dbPath, clock);
  seedBuiltins(storage);
  storage.close();

  const configPath = join(apmDir, 'config.yaml');
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG);

  return { created: !alreadyInitialized, dbPath };
}
