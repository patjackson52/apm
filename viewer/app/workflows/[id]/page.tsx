import { WorkflowGraphPanel } from '@/components/workflow/WorkflowGraphPanel';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkflowGraphPanel id={id} />;
}
