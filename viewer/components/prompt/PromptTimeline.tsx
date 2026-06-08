"use client";
import { MessageSquareText, Check, Loader, ArrowRight } from 'lucide-react';
import type { StructuredDispatch } from '@apm/types';

/**
 * The ordered sequence of agent_prompt dispatches for a run. Each node shows
 * name@version + a completed (check) / running (loader) status icon, with an
 * is-current highlight keyed on step_id.
 */
export function PromptTimeline({
  items,
  currentId,
  onSelect,
}: {
  items: StructuredDispatch[];
  currentId?: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="ptl">
      {items.map((d, i) => {
        const ver = d.prompt_name != null ? `${d.prompt_name}@${d.prompt_version ?? '?'}` : '—';
        return (
          <span className="ptl__step" key={d.step_id}>
            <button
              type="button"
              className={`ptl__node ${currentId === d.step_id ? 'is-current' : ''}`}
              onClick={() => onSelect?.(d.step_id)}
            >
              <span className="ptl__ico">
                <MessageSquareText size={13} aria-hidden />
              </span>
              <span className="ptl__main">
                <span className="ptl__name">{d.step_id}</span>
                <span className="ptl__sub">{ver}</span>
              </span>
              {d.status === 'completed' && <Check size={14} className="ptl__check" aria-label="completed" />}
              {d.status === 'running' && <Loader size={14} className="ptl__run" aria-label="running" />}
            </button>
            {i < items.length - 1 && <ArrowRight size={15} className="ptl__arrow" aria-hidden />}
          </span>
        );
      })}
    </div>
  );
}
