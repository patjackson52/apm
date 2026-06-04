import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';

export interface ProjectEntry { id: string; name: string; path: string }
export interface ProjectView extends ProjectEntry { current: boolean }

function realpathOr(p: string): string {
  try { return realpathSync(p); } catch { return path.resolve(p); }
}
function sameRoot(a: string, b: string): boolean {
  return realpathOr(a) === realpathOr(b);
}
function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

/** Read the project registry; missing file -> empty list. `home` injected for tests. */
export function loadRegistry(home: string): ProjectEntry[] {
  try {
    const raw = readFileSync(path.join(home, '.apm', 'projects.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && typeof e.id === 'string' && typeof e.path === 'string')
          .map((e) => ({ id: e.id, name: e.name ?? path.basename(e.path), path: e.path }))
      : [];
  } catch {
    return [];
  }
}

/** Ensure the served project ROOT is in the registry (idempotent, dedup by realpath + unique id). */
export function ensureRegistered(registry: ProjectEntry[], projectRoot: string): ProjectEntry[] {
  if (registry.some((e) => sameRoot(e.path, projectRoot))) return registry;
  const base = slug(path.basename(projectRoot));
  let id = base;
  let n = 2;
  const ids = new Set(registry.map((e) => e.id));
  while (ids.has(id)) id = `${base}-${n++}`;
  return [...registry, { id, name: path.basename(projectRoot), path: projectRoot }];
}

/**
 * Resolve the project directory for a request. Returns a registered entry's path
 * ONLY when `id` exactly matches a registry id; otherwise the default dir. The
 * client-supplied `id` is NEVER interpolated into a path (no path injection).
 */
export function resolveProjectDir(registry: ProjectEntry[], id: string | null, defaultDir: string): string {
  if (!id) return defaultDir;
  const entry = registry.find((e) => e.id === id);
  return entry ? entry.path : defaultDir;
}

/** Project list with `current` set for the entry matching `currentRoot`. */
export function listProjects(registry: ProjectEntry[], currentRoot: string): ProjectView[] {
  return registry.map((e) => ({ ...e, current: sameRoot(e.path, currentRoot) }));
}
