'use client';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet } from './client';
import { ep, type WorkFilters } from './endpoints';
import { qk } from './keys';
import { useActiveProject } from '@/lib/project/ActiveProjectProvider';

const VOLATILE = 5000;
const SEMI = 10000;
type Opt = { refetchInterval?: number | false };

const useApiQuery = <T,>(key: readonly unknown[], path: string, schema: Parameters<typeof apiGet<T>>[1], poll: number | false, o?: Opt) => {
  const activeId = useActiveProject();
  const sep = path.includes('?') ? '&' : '?';
  const scopedPath = activeId ? `${path}${sep}project=${encodeURIComponent(activeId)}` : path;
  const scopedKey = activeId ? (['project', activeId, ...key] as unknown[]) : (key as unknown[]);
  return useQuery({
    queryKey: scopedKey,
    queryFn: () => apiGet<T>(scopedPath, schema),
    refetchInterval: o?.refetchInterval ?? poll,
  } as UseQueryOptions<T>);
};

export const useStatus = (o?: Opt) => useApiQuery(qk.status(), ep.status.path(), ep.status.schema, VOLATILE, o);
export const useWorkItems = (f: WorkFilters = {}, o?: Opt) => useApiQuery(qk.work(f), ep.work.path(f), ep.work.schema, SEMI, o);
export const useWorkItem = (id: string, o?: Opt) => useApiQuery(qk.workItem(id), ep.workItem.path(id), ep.workItem.schema, SEMI, o);
export const useWorkChildren = (id: string, o?: Opt) => useApiQuery(qk.workChildren(id), ep.workChildren.path(id), ep.workChildren.schema, SEMI, o);
export const useWorkBlockers = (id: string, o?: Opt) => useApiQuery(qk.workBlockers(id), ep.workBlockers.path(id), ep.workBlockers.schema, VOLATILE, o);
export const useWorkArtifacts = (id: string, o?: Opt) => useApiQuery(qk.workArtifacts(id), ep.workArtifacts.path(id), ep.workArtifacts.schema, SEMI, o);
export const useRuns = (id: string, o?: Opt) => useApiQuery(qk.runs(id), ep.workRuns.path(id), ep.workRuns.schema, VOLATILE, o);
export const useRunSteps = (runId: string, o?: Opt) => useApiQuery(qk.steps(runId), ep.runSteps.path(runId), ep.runSteps.schema, VOLATILE, o);
export const useArtifact = (id: string, o?: Opt) => useApiQuery(qk.artifact(id), ep.artifact.path(id), ep.artifact.schema, false, o);
export const useWorkflows = (o?: Opt) => useApiQuery(qk.workflows(), ep.workflows.path(), ep.workflows.schema, false, o);
export const useWorkflow = (id: string, o?: Opt) => useApiQuery(qk.workflow(id), ep.workflow.path(id), ep.workflow.schema, false, o);
export const useDecisions = (wi?: string, o?: Opt) => useApiQuery(qk.decisions(wi), ep.decisions.path(wi), ep.decisions.schema, false, o);
export const useAdrs = (o?: Opt) => useApiQuery(qk.adr(), ep.adr.path(), ep.adr.schema, false, o);
export const useAdr = (id: string, o?: Opt) => useApiQuery(qk.adrShow(id), ep.adrShow.path(id), ep.adrShow.schema, false, o);
export const useBlockers = (wi?: string, o?: Opt) => useApiQuery(qk.blockers(wi), ep.blockers.path(wi), ep.blockers.schema, VOLATILE, o);
export const useGates = (wi?: string, o?: Opt) => useApiQuery(qk.gates(wi), ep.gates.path(wi), ep.gates.schema, VOLATILE, o);
export const useLeases = (f: { workItem?: string; agent?: string } = {}, o?: Opt) => useApiQuery(qk.leases(f), ep.leases.path(f), ep.leases.schema, VOLATILE, o);
export const useEvents = (f: import('./endpoints').EventsFilter = {}, o?: Opt) => useApiQuery(qk.events(f), ep.events.path(f), ep.events.schema, VOLATILE, o);
export const useSessions = (o?: Opt) => useApiQuery(qk.sessions(), ep.sessions.path(), ep.sessions.schema, SEMI, o);
export const useProjects = (o?: Opt) => useApiQuery(qk.projects(), ep.projects.path(), ep.projects.schema, SEMI, o);
