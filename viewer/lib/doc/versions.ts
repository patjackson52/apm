import type { ArtifactView } from '@apm/types';

/** Group artifacts by their version root, each group sorted by version desc. */
export function groupByRoot(artifacts: ArtifactView[]): Map<string, ArtifactView[]> {
  const map = new Map<string, ArtifactView[]>();
  for (const a of artifacts) {
    const list = map.get(a.root) ?? [];
    list.push(a);
    map.set(a.root, list);
  }
  for (const list of map.values()) list.sort((x, y) => y.version - x.version);
  return map;
}
