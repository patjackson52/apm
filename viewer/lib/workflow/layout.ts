export interface StepLite { id: string; type: string }
export interface EdgeLite { from: string; to: string }
export interface PositionedNode { id: string; type: string; x: number; y: number }
export interface LaidOutGraph { nodes: PositionedNode[]; edges: EdgeLite[] }

const ROW = 110;
const COL = 0;

/**
 * Deterministic layout for a (V1-linear) workflow. Ranks steps by a topological
 * walk along edges from the entry step (no incoming edge); y = rank*ROW. Steps
 * not reachable via edges fall back to source order after the chain. Pure — no
 * Date/random — so positions are stable across renders and unit tests.
 */
export function layoutGraph(steps: StepLite[], edges: EdgeLite[]): LaidOutGraph {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const incoming = new Set(edges.map((e) => e.to));
  const nextOf = new Map<string, string[]>();
  for (const e of edges) {
    const list = nextOf.get(e.from) ?? [];
    list.push(e.to);
    nextOf.set(e.from, list);
  }

  const rank = new Map<string, number>();
  // entry steps: appear in steps order, have no incoming edge
  const entries = steps.filter((s) => !incoming.has(s.id));
  let nextRank = 0;
  const visit = (id: string) => {
    if (rank.has(id) || !byId.has(id)) return;
    rank.set(id, nextRank++);
    for (const n of nextOf.get(id) ?? []) visit(n);
  };
  for (const e of entries) visit(e.id);
  // stray nodes (cycles / unreferenced) appended in source order
  for (const s of steps) if (!rank.has(s.id)) rank.set(s.id, nextRank++);

  const nodes: PositionedNode[] = steps.map((s) => ({
    id: s.id,
    type: s.type,
    x: COL,
    y: (rank.get(s.id) ?? 0) * ROW,
  }));
  return { nodes, edges };
}
