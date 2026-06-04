"use client";
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { metaFor, tintKey } from '@/lib/workflow/stepMeta';
import s from './StepNode.module.css';

export interface StepNodeData extends Record<string, unknown> {
  id: string;
  type: string;
  onSelect?: () => void;
}
export type StepFlowNode = Node<StepNodeData, 'step'>;

/** Read-only workflow node. Renders type label + step id; Enter selects it. */
export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const meta = metaFor(data.type);
  return (
    <div
      className={`${s.node} ${s[`t_${tintKey(data.type)}`] ?? ''}`}
      role="group"
      aria-label={`${meta.label}: ${data.id}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelect?.();
        }
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className={s.type}>{meta.label}</div>
      <div className={s.id}>{data.id}</div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
