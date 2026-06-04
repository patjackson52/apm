"use client";
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { metaFor, tintKey } from '@/lib/workflow/stepMeta';
import { stepStatusTintKey } from '@/lib/workflow/statusTint';
import type { ReviewerMark } from '@/lib/workflow/runOverlay';
import s from './StepNode.module.css';

export interface StepNodeData extends Record<string, unknown> {
  id: string;
  type: string;
  onSelect?: () => void;
  // Optional run-state overlay (WI-33). Absent -> identical to WI-32 rendering.
  status?: string;
  isCurrent?: boolean;
  reviewers?: ReviewerMark[];
}
export type StepFlowNode = Node<StepNodeData, 'step'>;

const VERDICT_GLYPH: Record<string, string> = { pass: '✓', reject: '✗', abstain: '·' };
function verdictGlyph(v: ReviewerMark['verdict']): string {
  return v ? (VERDICT_GLYPH[v] ?? '?') : '◦'; // null verdict (running reviewer) -> distinct "pending" glyph
}

/** Read-only workflow node + optional run-state overlay. Enter selects it. */
export function StepNode({ data }: NodeProps<StepFlowNode>) {
  const meta = metaFor(data.type);
  const statusClass = data.status ? s[`rs_${stepStatusTintKey(data.status)}`] : undefined;
  return (
    <div
      className={[s.node, s[`t_${tintKey(data.type)}`], statusClass, data.isCurrent ? s.current : '']
        .filter(Boolean)
        .join(' ')}
      role="group"
      aria-label={`${meta.label}: ${data.id}${data.status ? ` (${data.status})` : ''}${data.isCurrent ? ' — current' : ''}`}
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
      {data.reviewers && data.reviewers.length > 0 ? (
        <div className={s.reviewers}>
          {data.reviewers.map((r, i) => (
            <span
              key={i}
              className={`${s.badge} ${s[`v_${r.verdict ?? 'pending'}`] ?? ''}`}
              aria-label={`${r.role ?? 'reviewer'}: ${r.verdict ?? 'pending'}`}
              title={`${r.role ?? 'reviewer'}: ${r.verdict ?? 'pending'} (round ${r.round})`}
            >
              {verdictGlyph(r.verdict)}
            </span>
          ))}
        </div>
      ) : null}
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}
