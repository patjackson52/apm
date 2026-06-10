"use client";
import { MessageSquareText, Ban, Workflow, FileQuestion } from 'lucide-react';
import type { PromptPanelView } from '@apm/types';
import { Skeleton } from '@/components/Skeleton';
import { usePromptPanel } from '@/lib/api/hooks';
import { ComposedPrompt } from './ComposedPrompt';
import { PromptTimeline } from './PromptTimeline';
import { ProvenanceChip } from './ProvenanceChip';
import { EditViaCli } from './EditViaCli';

const STATE_LABEL: Record<PromptPanelView['state'], string> = {
  'pre-run': 'Will run — preview as of now',
  active: 'Dispatched',
  completed: 'Started with',
  blocked: 'Blocked',
  'no-prompt': "Current step doesn't dispatch a prompt",
  'no-workflow': 'No workflow attached',
};

type Banner = { tone: 'blocked' | 'muted'; icon: React.ReactNode; t: string; d: string };

const BANNERS: Partial<Record<PromptPanelView['state'], Banner>> = {
  blocked: {
    tone: 'blocked',
    icon: <Ban size={15} aria-hidden />,
    t: 'Blocked at a human gate',
    d: "No prompt is dispatched now. The last dispatched prompt is shown in the timeline below.",
  },
  'no-workflow': {
    tone: 'muted',
    icon: <Workflow size={15} aria-hidden />,
    t: 'No workflow attached',
    d: 'This item has no run or definition. A workflow with agent_prompt steps is required to dispatch a prompt.',
  },
  'no-prompt': {
    tone: 'muted',
    icon: <FileQuestion size={15} aria-hidden />,
    t: "Current step doesn't dispatch a prompt",
    d: 'The current step (agent_execution / integration / etc.) has no stored body. See the timeline below.',
  },
};

function PPBanner({ banner }: { banner: Banner }) {
  return (
    <div className={`pp-banner ${banner.tone === 'blocked' ? 'pp-banner--blocked' : ''}`}>
      <span className="pp-banner__ico">{banner.icon}</span>
      <div className="pp-banner__main">
        <div className="pp-banner__t">{banner.t}</div>
        <div className="pp-banner__d">{banner.d}</div>
      </div>
    </div>
  );
}

/**
 * Persistent work-item Prompt panel (Surface 1). Renders the headline composed
 * prompt, a state banner, the agent_prompt timeline, and provenance + edit
 * affordances — all keyed off the live PromptPanelView state.
 */
export function PromptPanel({ workItemId }: { workItemId: string }) {
  const { data, isLoading, isError } = usePromptPanel(workItemId);

  if (isLoading) return <Skeleton count={4} />;
  if (isError || !data) return <p>Failed to load prompt.</p>;

  const banner = BANNERS[data.state];
  const prov = data.provenance;

  return (
    <div className="pp">
      <div className="pp__head">
        <span className="pp__glyph">
          <MessageSquareText size={18} aria-hidden />
        </span>
        <div className="pp__headmain">
          <div className="pp__kicker">
            <span className="eyebrow">Prompt</span>
          </div>
          <h3 className="pp__title">{STATE_LABEL[data.state]}</h3>
        </div>
        {prov && (
          <div className="pp__headright">
            <ProvenanceChip name={prov.name} version={prov.version} latest={prov.latest} />
            <EditViaCli name={prov.name} body={data.headline?.body ?? ''} />
          </div>
        )}
      </div>

      {banner && <PPBanner banner={banner} />}

      {data.timeline.length > 0 && (
        <div className="pp__section">
          <PromptTimeline items={data.timeline} currentId={data.headline?.step_id} />
        </div>
      )}

      {data.headline && (
        <div className="pp__section">
          <ComposedPrompt dispatch={data.headline} clampBody />
        </div>
      )}
    </div>
  );
}
