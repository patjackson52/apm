"use client";
import { ReactFlow, Background, Controls, type Node, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { layoutGraph, type StepLite, type EdgeLite } from '@/lib/workflow/layout';
import type { StepOverlay } from '@/lib/workflow/runOverlay';
import { StepNode, type StepFlowNode } from './StepNode';
import { Legend } from './Legend';
import s from './WorkflowGraph.module.css';

const nodeTypes = { step: StepNode };

/** Read-only react-flow workflow canvas built from steps[]/edges[]. */
export function WorkflowGraph({
  steps,
  edges,
  onSelectStep,
  overlay,
  currentStep,
}: {
  steps: StepLite[];
  edges: EdgeLite[];
  onSelectStep?: (id: string) => void;
  overlay?: Map<string, StepOverlay>;
  currentStep?: string | null;
}) {
  const laid = layoutGraph(steps, edges);
  const rfNodes: Node<StepFlowNode['data']>[] = laid.nodes.map((n) => ({
    id: n.id,
    type: 'step',
    position: { x: n.x, y: n.y },
    data: {
      id: n.id,
      type: n.type,
      onSelect: () => onSelectStep?.(n.id),
      status: overlay?.get(n.id)?.status,
      isCurrent: currentStep === n.id,
      reviewers: overlay?.get(n.id)?.reviewers,
    },
    draggable: false,
  }));
  const rfEdges: Edge[] = laid.edges.map((e) => ({
    id: `${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
  }));

  return (
    <div className={s.canvas} data-testid="workflow-graph">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      <Legend />
    </div>
  );
}
