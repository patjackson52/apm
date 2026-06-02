import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../domain/clock.js';
import { SqliteStorage } from '../storage/sqlite.js';

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
export function initProject(dir: string, clock: Clock): InitResult {
  const apmDir = join(dir, '.apm');
  const dbPath = join(apmDir, 'apm.db');
  const alreadyInitialized = existsSync(dbPath);

  mkdirSync(apmDir, { recursive: true });

  const storage = new SqliteStorage(dbPath, clock);
  storage.close();

  const configPath = join(apmDir, 'config.yaml');
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG);

  return { created: !alreadyInitialized, dbPath };
}
