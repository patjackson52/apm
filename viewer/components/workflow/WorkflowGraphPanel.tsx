"use client";
import { useWorkflow } from '@/lib/api/hooks';
import { Skeleton } from '@/components/Skeleton';
import { WorkflowGraph } from './WorkflowGraph';

/** Loads a workflow def and renders its read-only graph. */
export function WorkflowGraphPanel({ id }: { id: string }) {
  const { data, isLoading, isError } = useWorkflow(id);
  if (isLoading) return <Skeleton count={6} h={40} />;
  if (isError || !data) return <p>Failed to load workflow.</p>;
  if (data.steps.length === 0) return <p>This workflow has no steps.</p>;
  return (
    <section>
      <h1>{data.name}</h1>
      <WorkflowGraph steps={data.steps} edges={data.edges} />
    </section>
  );
}
